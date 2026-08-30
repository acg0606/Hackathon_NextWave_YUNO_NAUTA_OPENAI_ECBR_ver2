'use client';

import 'maplibre-gl/dist/maplibre-gl.css';

import { useEffect, useRef, useState } from 'react';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import Image from 'next/image';
import earthPoster from '../assets/plates/earth-globe.png';
import type { Scenario } from './scenarios';

type LiveEarthProps = {
  scenario: Scenario;
  rerouted: boolean;
  picking: boolean;
  destinationCoordinates: [number, number];
  destinationLabel: string;
  onPick: (coordinates: [number, number]) => void;
  onLiveContext: (count: number | null) => void;
};

type Coordinates = [number, number];
type PointFeature = {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: { type: 'Point'; coordinates: Coordinates };
};
type LineFeature = {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: { type: 'LineString'; coordinates: Coordinates[] };
};
type PointCollection = { type: 'FeatureCollection'; features: PointFeature[] };
type EonetFeature = {
  properties?: { id?: string };
  geometry?: { type?: string; coordinates?: unknown };
};
type EonetCollection = { features?: EonetFeature[] };

const detours: Record<string, [number, number]> = {
  'EVT-012': [-0.4543, 51.47],
  'EVT-014': [34.6415, 36.8121],
  'EVT-017': [-19, 24],
  'EVT-001': [18.47, -34.36],
  'EVT-005': [-76.2859, 36.8508],
  'EVT-004': [-118.2437, 34.0522],
  'EVT-008': [51.6081, 25.2731],
  'EVT-009': [-130.3208, 54.315],
  'EVT-011': [-122.3321, 47.6062],
  'EVT-010': [-63.5752, 44.6488],
};

function greatCircle(from: Coordinates, to: Coordinates, steps = 48): Coordinates[] {
  if (from[0] === to[0] && from[1] === to[1]) return [from];

  const radians = Math.PI / 180;
  const degrees = 180 / Math.PI;
  const lon1 = from[0] * radians;
  const lat1 = from[1] * radians;
  const lon2 = to[0] * radians;
  const lat2 = to[1] * radians;
  const delta = 2 * Math.asin(Math.sqrt(
    Math.sin((lat2 - lat1) / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
  ));

  if (delta === 0) return [from];

  return Array.from({ length: steps + 1 }, (_, index) => {
    const fraction = index / steps;
    const a = Math.sin((1 - fraction) * delta) / Math.sin(delta);
    const b = Math.sin(fraction * delta) / Math.sin(delta);
    const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
    const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
    const z = a * Math.sin(lat1) + b * Math.sin(lat2);
    return [
      Math.atan2(y, x) * degrees,
      Math.atan2(z, Math.sqrt(x * x + y * y)) * degrees,
    ] as Coordinates;
  });
}

function lineFeature(
  scenario: Scenario,
  destination: [number, number],
  rerouted: boolean,
): LineFeature {
  const anchors = rerouted
    ? [scenario.originCoordinates, detours[scenario.id], destination]
    : [scenario.originCoordinates, scenario.coordinates, destination];
  const coordinates = anchors.flatMap((anchor, index) => {
    if (index === anchors.length - 1) return [];
    const leg = greatCircle(anchor, anchors[index + 1]);
    return index === 0 ? leg : leg.slice(1);
  });

  return {
    type: 'Feature',
    properties: { rerouted },
    geometry: { type: 'LineString', coordinates },
  };
}

function pointCollection(
  scenario: Scenario,
  destination: [number, number],
): PointCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { role: 'origin' },
        geometry: { type: 'Point', coordinates: scenario.originCoordinates },
      },
      {
        type: 'Feature',
        properties: { role: 'destination' },
        geometry: { type: 'Point', coordinates: destination },
      },
      {
        type: 'Feature',
        properties: { role: 'event' },
        geometry: { type: 'Point', coordinates: scenario.coordinates },
      },
    ],
  };
}

export function LiveEarth({
  scenario,
  rerouted,
  picking,
  destinationCoordinates,
  destinationLabel,
  onPick,
  onLiveContext,
}: LiveEarthProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onPickRef = useRef(onPick);
  const pickingRef = useRef(picking);
  const scenarioRef = useRef(scenario);
  const destinationRef = useRef(destinationCoordinates);
  const reroutedRef = useRef(rerouted);
  const liveContextRef = useRef(onLiveContext);
  const overlayUpdateRef = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState<'loading' | 'webgl' | 'fallback'>('loading');

  useEffect(() => {
    onPickRef.current = onPick;
    pickingRef.current = picking;
    scenarioRef.current = scenario;
    destinationRef.current = destinationCoordinates;
    reroutedRef.current = rerouted;
    liveContextRef.current = onLiveContext;
  }, [destinationCoordinates, onLiveContext, onPick, picking, rerouted, scenario]);

  useEffect(() => {
    let active = true;
    let map: MapLibreMap | null = null;
    let overlay: SVGSVGElement | null = null;
    let drawOverlay: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;

    async function mountMap() {
      if (!containerRef.current) return;

      try {
        const maplibregl = await import('maplibre-gl');
        if (!active || !containerRef.current) return;
        maplibregl.setWorkerUrl(maplibreWorkerUrl);

        map = new maplibregl.Map({
          container: containerRef.current,
          center: [-24, 22],
          zoom: 1.72,
          minZoom: 0.35,
          maxZoom: 5,
          attributionControl: false,
          renderWorldCopies: false,
          style: {
            version: 8,
            projection: { type: 'globe' },
            sources: {
              nasaBlueMarble: {
                type: 'raster',
                tiles: [
                  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',
                ],
                tileSize: 256,
                maxzoom: 8,
                attribution: 'NASA EOSDIS GIBS',
              },
            },
            layers: [
              {
                id: 'blue-marble',
                type: 'raster',
                source: 'nasaBlueMarble',
                paint: {
                  'raster-saturation': -0.08,
                  'raster-contrast': 0.12,
                  'raster-brightness-max': 0.78,
                },
              },
            ],
            sky: {
              'atmosphere-blend': [
                'interpolate',
                ['linear'],
                ['zoom'],
                0,
                1,
                5,
                0.6,
                7,
                0,
              ],
            },
          } as never,
        });

        mapRef.current = map;
        map.dragRotate.enable();
        map.touchZoomRotate.enableRotation();

        map.on('load', () => {
          if (!map) return;

          map.addSource('route', {
            type: 'geojson',
            data: lineFeature(scenarioRef.current, destinationRef.current, reroutedRef.current),
          });
          map.addLayer({
            id: 'route-shadow',
            type: 'line',
            source: 'route',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#ffb000',
              'line-width': 14,
              'line-opacity': 0.34,
              'line-blur': 7,
            },
          });
          map.addLayer({
            id: 'route-line',
            type: 'line',
            source: 'route',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': reroutedRef.current ? '#66d3a3' : '#ffb000',
              'line-width': 4.5,
              'line-dasharray': reroutedRef.current ? [1, 0] : [2, 1.5],
            },
          });

          map.addSource('journey-points', {
            type: 'geojson',
            data: pointCollection(scenarioRef.current, destinationRef.current),
          });
          map.addLayer({
            id: 'journey-points-halo',
            type: 'circle',
            source: 'journey-points',
            paint: {
              'circle-radius': ['match', ['get', 'role'], 'event', 20, 13],
              'circle-color': ['match', ['get', 'role'], 'event', scenarioRef.current.accent, '#fff3d6'],
              'circle-opacity': 0.25,
              'circle-blur': 0.45,
            },
          });
          map.addLayer({
            id: 'journey-points',
            type: 'circle',
            source: 'journey-points',
            paint: {
              'circle-radius': ['match', ['get', 'role'], 'event', 8, 6],
              'circle-color': ['match', ['get', 'role'], 'event', scenarioRef.current.accent, '#fff3d6'],
              'circle-stroke-width': 1.5,
              'circle-stroke-color': '#06101d',
            },
          });

          overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          overlay.classList.add('live-earth__route-overlay');
          overlay.setAttribute('aria-hidden', 'true');
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.classList.add('live-earth__route-path');
          overlay.appendChild(path);
          const roles = ['origin', 'destination', 'event'] as const;
          const circles = roles.map((role) => {
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.classList.add('live-earth__route-point', `live-earth__route-point--${role}`);
            circle.setAttribute('r', role === 'event' ? '7' : '5');
            overlay?.appendChild(circle);
            return circle;
          });
          containerRef.current?.appendChild(overlay);

          drawOverlay = () => {
            if (!map || !overlay || !containerRef.current) return;
            const width = containerRef.current.clientWidth;
            const height = containerRef.current.clientHeight;
            overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
            const route = lineFeature(
              scenarioRef.current,
              destinationRef.current,
              reroutedRef.current,
            ).geometry.coordinates;
            const projected = route.map((coordinates) => map?.project(coordinates));
            path.setAttribute(
              'd',
              projected
                .filter((point): point is NonNullable<typeof point> => Boolean(point))
                .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
                .join(' '),
            );
            path.setAttribute('stroke', reroutedRef.current ? '#66d3a3' : '#ffb000');
            const pointCoordinates = [
              scenarioRef.current.originCoordinates,
              destinationRef.current,
              scenarioRef.current.coordinates,
            ];
            circles.forEach((circle, index) => {
              const point = map?.project(pointCoordinates[index]);
              if (!point) return;
              circle.setAttribute('cx', point.x.toFixed(1));
              circle.setAttribute('cy', point.y.toFixed(1));
              circle.setAttribute('fill', index === 2 ? scenarioRef.current.accent : '#fff3d6');
            });
          };

          overlayUpdateRef.current = drawOverlay;
          map.on('move', drawOverlay);
          map.on('resize', drawOverlay);
          resizeObserver = new ResizeObserver(() => {
            map?.resize();
            drawOverlay?.();
          });
          if (containerRef.current) resizeObserver.observe(containerRef.current);
          drawOverlay();

          setStatus('webgl');
        });

        map.on('click', (event) => {
          if (!pickingRef.current) return;
          onPickRef.current([
            Number(event.lngLat.lng.toFixed(4)),
            Number(event.lngLat.lat.toFixed(4)),
          ]);
        });

        map.on('error', (event) => {
          if (event.error.message.includes('WebGL')) setStatus('fallback');
        });
      } catch {
        if (active) setStatus('fallback');
      }
    }

    void mountMap();

    void fetch('https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&days=20&limit=80')
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error('EONET unavailable'))))
      .then((body) => JSON.parse(body) as EonetCollection)
      .then((data) => {
        if (!active) return;
        const points = (data.features ?? []).filter((feature) => feature.geometry?.type === 'Point');
        const eventIds = new Set(
          points
            .map((feature) => feature.properties?.id)
            .filter((id): id is string => Boolean(id)),
        );
        liveContextRef.current(eventIds.size || points.length);
      })
      .catch(() => liveContextRef.current(null));

    return () => {
      active = false;
      if (map && drawOverlay) {
        map.off('move', drawOverlay);
        map.off('resize', drawOverlay);
      }
      resizeObserver?.disconnect();
      overlay?.remove();
      overlayUpdateRef.current = null;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    void (map.getSource('route') as GeoJSONSource | undefined)?.setData(
      lineFeature(scenario, destinationCoordinates, rerouted),
    );
    void (map.getSource('journey-points') as GeoJSONSource | undefined)?.setData(
      pointCollection(scenario, destinationCoordinates),
    );
    map.setPaintProperty('route-line', 'line-color', rerouted ? '#66d3a3' : '#ffb000');
    const camera = { center: scenario.coordinates, zoom: rerouted ? 1.62 : 1.48 } as const;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      map.jumpTo(camera);
    } else {
      map.easeTo({ ...camera, duration: 900 });
    }
    overlayUpdateRef.current?.();
  }, [destinationCoordinates, rerouted, scenario]);

  return (
    <div className={`live-earth live-earth--${status}${picking ? ' is-picking' : ''}`}>
      <Image className="live-earth__poster" src={earthPoster} alt="" fill priority sizes="(max-width: 820px) 100vw, 53vw" />
      <div
        ref={containerRef}
        className="live-earth__map"
        aria-label="Globo terrestre interativo com a rota da entrega"
        aria-describedby="earth-route-summary"
      />
      <p id="earth-route-summary" className="live-earth__route-summary">
        Rota {rerouted ? 'alternativa' : 'planejada'}: {scenario.origin} → evento em {scenario.place} → {destinationLabel}.
        Para definir o destino sem mouse, use os campos de latitude e longitude na área de compra.
      </p>
      <div className="live-earth__status" aria-live="polite">
        <span className="live-earth__pulse" />
        {status === 'webgl' ? 'TERRA · WEBGL + NASA' : status === 'loading' ? 'CARREGANDO TERRA' : 'TERRA · POSTER SEGURO'}
      </div>
      <div className="live-earth__credit">NASA GIBS · âncoras visuais aproximadas</div>
    </div>
  );
}
