'use client';

import 'maplibre-gl/dist/maplibre-gl.css';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import Image from 'next/image';
import earthPoster from '../assets/plates/earth-globe.png';

export type Coordinates = [number, number];

export type RoutePointViewModel = {
  id: string;
  label: string;
  coordinates: Coordinates;
};

export type RouteViewModel = {
  id: string;
  origin: RoutePointViewModel;
  destination: RoutePointViewModel;
  waypoints?: RoutePointViewModel[];
  traffic?: RoutePointViewModel[];
  event?: RoutePointViewModel;
  focusCoordinates?: Coordinates;
  state: 'draft' | 'planned' | 'in-transit' | 'disrupted' | 'rerouted' | 'held' | 'delivered' | 'unknown';
  accent?: string;
  editable?: boolean;
  attribution?: string;
};

type LiveEarthProps = {
  model: RouteViewModel;
  picking?: boolean;
  onPick?: (coordinates: Coordinates) => void;
  onStatusChange?: (status: 'loading' | 'webgl' | 'fallback') => void;
};

type PointFeature = {
  type: 'Feature';
  properties: { id: string; label: string; role: 'origin' | 'destination' | 'waypoint' | 'event' | 'traffic' };
  geometry: { type: 'Point'; coordinates: Coordinates };
};

type LineFeature = {
  type: 'Feature';
  properties: { state: RouteViewModel['state'] };
  geometry: { type: 'LineString'; coordinates: Coordinates[] };
};

type PointCollection = { type: 'FeatureCollection'; features: PointFeature[] };

function coordinatesEqual(left: Coordinates, right: Coordinates) {
  return left[0] === right[0] && left[1] === right[1];
}

function pathPoints(model: RouteViewModel): RoutePointViewModel[] {
  const points = [model.origin, ...(model.waypoints ?? []), model.destination];
  return points.filter((point, index) => (
    index === 0 || !coordinatesEqual(point.coordinates, points[index - 1].coordinates)
  ));
}

function greatCircle(from: Coordinates, to: Coordinates, steps = 48): Coordinates[] {
  if (coordinatesEqual(from, to)) return [from];

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

function lineFeature(model: RouteViewModel): LineFeature {
  const anchors = pathPoints(model);
  const coordinates = anchors.flatMap((point, index) => {
    if (index === anchors.length - 1) return [];
    const leg = greatCircle(point.coordinates, anchors[index + 1].coordinates);
    return index === 0 ? leg : leg.slice(1);
  });
  return {
    type: 'Feature',
    properties: { state: model.state },
    geometry: { type: 'LineString', coordinates },
  };
}

function pointCollection(model: RouteViewModel): PointCollection {
  const routePoints = pathPoints(model);
  const features: PointFeature[] = routePoints.map((point, index) => ({
    type: 'Feature',
    properties: {
      id: point.id,
      label: point.label,
      role: index === 0 ? 'origin' : index === routePoints.length - 1 ? 'destination' : 'waypoint',
    },
    geometry: { type: 'Point', coordinates: point.coordinates },
  }));
  if (model.event && !features.some((feature) => coordinatesEqual(feature.geometry.coordinates, model.event?.coordinates ?? [0, 0]))) {
    features.push({
      type: 'Feature',
      properties: { id: model.event.id, label: model.event.label, role: 'event' },
      geometry: { type: 'Point', coordinates: model.event.coordinates },
    });
  }
  for (const point of model.traffic ?? []) {
    if (features.some((feature) => coordinatesEqual(feature.geometry.coordinates, point.coordinates))) continue;
    features.push({
      type: 'Feature',
      properties: { id: point.id, label: point.label, role: 'traffic' },
      geometry: { type: 'Point', coordinates: point.coordinates },
    });
  }
  return { type: 'FeatureCollection', features };
}

function routeColor(model: RouteViewModel) {
  if (model.state === 'rerouted' || model.state === 'delivered') return '#66d3a3';
  if (model.state === 'held' || model.state === 'disrupted') return '#ffb000';
  return model.accent ?? '#7c9fff';
}

function routeSummary(model: RouteViewModel) {
  const labels = pathPoints(model).map((point) => point.label);
  const event = model.event ? ` Disruption marker: ${model.event.label}.` : '';
  const editHint = model.editable ? ' A keyboard-accessible coordinate editor is available in the order surface.' : '';
  const traffic = model.traffic?.length
    ? ` ${model.traffic.length} current corridor traffic observations are shown; they are not proof of shipment assignment.`
    : '';
  return `${model.state.replace('-', ' ')} route: ${labels.join(' to ')}.${event}${traffic}${editHint}`;
}

export function LiveEarth({ model, picking = false, onPick, onStatusChange }: LiveEarthProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const modelRef = useRef(model);
  const onPickRef = useRef(onPick);
  const pickingRef = useRef(picking);
  const overlayUpdateRef = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState<'loading' | 'webgl' | 'fallback'>('loading');
  const [networkWarning, setNetworkWarning] = useState(false);
  const summaryId = useMemo(() => `earth-route-summary-${model.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`, [model.id]);

  useEffect(() => {
    modelRef.current = model;
    onPickRef.current = onPick;
    pickingRef.current = picking;
  }, [model, onPick, picking]);

  useEffect(() => {
    onStatusChange?.(status);
  }, [onStatusChange, status]);

  useEffect(() => {
    let active = true;
    let map: MapLibreMap | null = null;
    let overlay: SVGSVGElement | null = null;
    let drawOverlay: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let tileErrorCount = 0;
    const fallbackTimer = window.setTimeout(() => {
      if (active) setStatus((current) => current === 'loading' ? 'fallback' : current);
    }, 9_000);

    async function mountMap() {
      if (!containerRef.current) return;

      try {
        const maplibregl = await import('maplibre-gl');
        if (!active || !containerRef.current) return;
        maplibregl.setWorkerUrl(maplibreWorkerUrl);

        map = new maplibregl.Map({
          container: containerRef.current,
          center: modelRef.current.focusCoordinates ?? modelRef.current.event?.coordinates ?? [12, 23],
          zoom: 1.52,
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
            layers: [{
              id: 'blue-marble',
              type: 'raster',
              source: 'nasaBlueMarble',
              paint: {
                'raster-saturation': -0.08,
                'raster-contrast': 0.12,
                'raster-brightness-max': 0.78,
              },
            }],
            sky: {
              'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 0.6, 7, 0],
            },
          } as never,
        });

        mapRef.current = map;
        map.dragRotate.enable();
        map.touchZoomRotate.enableRotation();

        map.on('load', () => {
          if (!map) return;
          const currentModel = modelRef.current;
          map.addSource('route', { type: 'geojson', data: lineFeature(currentModel) });
          map.addLayer({
            id: 'route-shadow',
            type: 'line',
            source: 'route',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': routeColor(currentModel),
              'line-width': 14,
              'line-opacity': 0.32,
              'line-blur': 7,
            },
          });
          map.addLayer({
            id: 'route-line',
            type: 'line',
            source: 'route',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': routeColor(currentModel),
              'line-width': 4.5,
              'line-dasharray': currentModel.state === 'disrupted' || currentModel.state === 'held' ? [2, 1.5] : [1, 0],
            },
          });

          map.addSource('journey-points', { type: 'geojson', data: pointCollection(currentModel) });
          map.addLayer({
            id: 'journey-points-halo',
            type: 'circle',
            source: 'journey-points',
            paint: {
              'circle-radius': ['match', ['get', 'role'], 'event', 20, 'traffic', 8, 'waypoint', 10, 13],
              'circle-color': ['match', ['get', 'role'], 'event', currentModel.accent ?? '#ffb000', 'traffic', '#65d8ff', '#fff3d6'],
              'circle-opacity': 0.25,
              'circle-blur': 0.45,
            },
          });
          map.addLayer({
            id: 'journey-points',
            type: 'circle',
            source: 'journey-points',
            paint: {
              'circle-radius': ['match', ['get', 'role'], 'event', 8, 'traffic', 3, 'waypoint', 4, 6],
              'circle-color': ['match', ['get', 'role'], 'event', currentModel.accent ?? '#ffb000', 'traffic', '#65d8ff', '#fff3d6'],
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
          containerRef.current?.appendChild(overlay);

          drawOverlay = () => {
            if (!map || !overlay || !containerRef.current) return;
            const width = containerRef.current.clientWidth;
            const height = containerRef.current.clientHeight;
            overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
            const projected = lineFeature(modelRef.current).geometry.coordinates.map((coordinates) => map?.project(coordinates));
            path.setAttribute(
              'd',
              projected
                .filter((point): point is NonNullable<typeof point> => Boolean(point))
                .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
                .join(' '),
            );
            path.setAttribute('stroke', routeColor(modelRef.current));
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
        });

        map.once('idle', () => {
          if (!active) return;
          window.clearTimeout(fallbackTimer);
          setStatus('webgl');
        });

        map.on('click', (event) => {
          if (!pickingRef.current || modelRef.current.editable === false) return;
          onPickRef.current?.([
            Number(event.lngLat.lng.toFixed(4)),
            Number(event.lngLat.lat.toFixed(4)),
          ]);
        });

        map.on('error', (event) => {
          const message = event.error.message.toLowerCase();
          if (message.includes('webgl') || message.includes('context lost')) {
            setStatus('fallback');
            return;
          }
          tileErrorCount += 1;
          if (tileErrorCount >= 3) {
            setNetworkWarning(true);
            setStatus('fallback');
          }
        });
      } catch {
        if (active) setStatus('fallback');
      }
    }

    void mountMap();

    return () => {
      active = false;
      window.clearTimeout(fallbackTimer);
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
    void (map.getSource('route') as GeoJSONSource | undefined)?.setData(lineFeature(model));
    void (map.getSource('journey-points') as GeoJSONSource | undefined)?.setData(pointCollection(model));
    map.setPaintProperty('route-line', 'line-color', routeColor(model));
    map.setPaintProperty('route-shadow', 'line-color', routeColor(model));
    map.setPaintProperty(
      'route-line',
      'line-dasharray',
      model.state === 'disrupted' || model.state === 'held' ? [2, 1.5] : [1, 0],
    );
    const camera = {
      center: model.focusCoordinates ?? model.event?.coordinates ?? model.destination.coordinates,
      zoom: model.state === 'delivered' ? 2.15 : 1.52,
    } as const;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) map.jumpTo(camera);
    else map.easeTo({ ...camera, duration: 900 });
    overlayUpdateRef.current?.();
  }, [model]);

  return (
    <div className={`live-earth live-earth--${status}${picking ? ' is-picking' : ''}${networkWarning ? ' has-network-warning' : ''}`}>
      <Image
        className="live-earth__poster"
        src={earthPoster}
        alt=""
        fill
        priority
        sizes="(max-width: 900px) 100vw, 53vw"
      />
      <div
        ref={containerRef}
        className="live-earth__map"
        aria-label="Interactive Earth showing the shipment route"
        aria-describedby={summaryId}
      />
      <p id={summaryId} className="live-earth__route-summary">{routeSummary(model)}</p>
      <div className="live-earth__status" aria-live="polite">
        <span className="live-earth__pulse" />
        {status === 'webgl' ? 'Earth · WebGL + NASA' : status === 'loading' ? 'Loading Earth' : 'Earth · safe poster'}
      </div>
      <div className="live-earth__credit">
        {networkWarning ? 'NASA imagery unavailable · route preserved in text' : model.attribution ?? 'NASA GIBS · approximate visual anchors'}
      </div>
    </div>
  );
}

export default LiveEarth;
