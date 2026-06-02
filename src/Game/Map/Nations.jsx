import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import { onRegionSelected } from "../Selection/Regions";
import { emitAdminRegionPick, isAdminActive } from "../Admin/adminBus.js";
import {
  JSON_URLS,
  PMTILES_PROTOCOL_URLS,
  ensurePmtilesProtocol,
  readJson,
} from "../../runtime/assets.js";
import {
  buildDynamicOwnerLabels,
  loadCountryLabelCollections,
  loadRegionLabelGeometry,
} from "../../runtime/countryLabels.js";

ensurePmtilesProtocol();
const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };
const EMPTY_REGION_GEOMETRY = { extent: 4096, regions: [] };

const buildCountryTextSize = (multiplier = 1) => ([
  "interpolate", ["exponential", 2], ["zoom"],
  0, ["*", multiplier, ["*", ["get", "areaScale"], ["^", 2, -16]]],
  4, ["*", multiplier, ["*", ["get", "areaScale"], ["^", 2, -12]]],
  8, ["*", multiplier, ["*", ["get", "areaScale"], ["^", 2, -8]]],
  12, ["*", multiplier, ["*", ["get", "areaScale"], ["^", 2, -4]]],
  16, ["*", multiplier, ["*", ["get", "areaScale"], ["^", 2, 0]]],
  20, ["*", multiplier, ["*", ["get", "areaScale"], ["^", 2, 4]]],
  24, ["*", multiplier, ["*", ["get", "areaScale"], ["^", 2, 8]]],
]);

const buildFallbackColorExpression = () => ([
  "rgb",
  ["+", 64, ["*", ["index-of", ["slice", ["get", "GID_0"], 0, 1], "ABCDEFGHIJKLMNOPQRSTUVWXYZ"], 5]],
  ["+", 64, ["*", ["index-of", ["slice", ["get", "GID_0"], 2, 3], "ABCDEFGHIJKLMNOPQRSTUVWXYZ"], 5]],
  ["+", 64, ["*", ["index-of", ["slice", ["get", "GID_0"], 1, 2], "ABCDEFGHIJKLMNOPQRSTUVWXYZ"], 5]],
]);

const fallbackColorFromCode = (code = "") => {
  const normalized = String(code ?? "").toUpperCase();
  if (normalized.length < 3) {
    return "rgb(96, 96, 96)";
  }

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const a = Math.max(0, alphabet.indexOf(normalized[0]));
  const b = Math.max(0, alphabet.indexOf(normalized[1]));
  const c = Math.max(0, alphabet.indexOf(normalized[2]));
  return `rgb(${64 + a * 5}, ${64 + c * 5}, ${64 + b * 5})`;
};

// Drop the baseline labels of owners whose territory changed (they are replaced
// by freshly recomputed dynamic labels, or hidden if the owner was emptied). An
// empty set leaves the collection untouched (and referentially stable).
const removeFeaturesByCode = (collection, codes) => {
  if (codes.size === 0) return collection;

  const features = (collection?.features ?? []).filter(
    (feature) => !codes.has(feature?.properties?.code),
  );

  return { type: "FeatureCollection", features };
};

const WorldMap = () => {
  const { current: map } = useMap();
  const [colorMap, setColorMap] = useState({});
  const [worldState, setWorldState] = useState({ regionOwnershipOverrides: {} });
  const [regionGeometry, setRegionGeometry] = useState(EMPTY_REGION_GEOMETRY);
  const [rawPointLabelData, setRawPointLabelData] = useState(EMPTY_FEATURE_COLLECTION);
  const [rawCurvedLabelData, setRawCurvedLabelData] = useState(EMPTY_FEATURE_COLLECTION);
  const countriesUrl = PMTILES_PROTOCOL_URLS.countries;
  const regionsUrl = PMTILES_PROTOCOL_URLS.regions;

  const handleRegionClick = useCallback((event) => {
    const features = map.queryRenderedFeatures(event.point, { layers: ["regions-fill"] });
    if (!features.length) return;

    const { COUNTRY, NAME_1, GID_0, GID_1 } = features[0].properties;

    if (isAdminActive()) {
      // In admin mode the click feeds the Admin panel as a source selection
      // instead of opening the normal region popup.
      emitAdminRegionPick({ COUNTRY, NAME_1, GID_0, GID_1 });
      return;
    }

    onRegionSelected({ COUNTRY, NAME_1, GID_0, GID_1, lngLat: event.lngLat });
  }, [map]);

  useEffect(() => {
    if (!map) return;
    map.on("click", handleRegionClick);
    return () => map.off("click", handleRegionClick);
  }, [handleRegionClick, map]);

  useEffect(() => {
    let cancelled = false;

    // Poll both world state (region ownership) and colors so that admin edits
    // — new owners, recolored or newly created states — show up within ~5s.
    const loadWorldState = () => {
      Promise.all([
        readJson(JSON_URLS.world, { defaultValue: {}, force: true }),
        readJson(JSON_URLS.colors, { defaultValue: {}, force: true }),
      ])
        .then(([world, colors]) => {
          if (!cancelled) {
            setWorldState(world ?? {});
            setColorMap(colors ?? {});
          }
        })
        .catch((error) => console.error("Error loading world state:", error));
    };

    loadWorldState();
    const interval = setInterval(loadWorldState, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    loadCountryLabelCollections()
      .then(({ pointLabelData: pointLabels, curvedLabelData: curvedLabels }) => {
        if (cancelled) return;
        setRawPointLabelData(pointLabels);
        setRawCurvedLabelData(curvedLabels);
      })
      .catch((error) => console.error("Failed to load country labels:", error));

    return () => {
      cancelled = true;
    };
  }, []);

  // Largest-ring geometry for every region (viewport-independent). It tells us
  // which countries are drawn at region granularity (to keep their base fill
  // transparent) and is the input for recomputing labels of reassigned owners.
  useEffect(() => {
    let cancelled = false;

    loadRegionLabelGeometry()
      .then((geometry) => {
        if (!cancelled) setRegionGeometry(geometry ?? EMPTY_REGION_GEOMETRY);
      })
      .catch((error) => console.error("Failed to load region geometry:", error));

    return () => {
      cancelled = true;
    };
  }, []);

  // Countries subdivided into regions (their fill is owned by the regions layer).
  const regionCountryCodes = useMemo(() => {
    const codes = new Set();
    for (const region of regionGeometry.regions) {
      if (region.code) codes.add(region.code);
    }
    return codes;
  }, [regionGeometry]);

  // Display name for any owner code: base country name from the regions tile,
  // overlaid by polity overrides (covers admin-renamed and newly-created states).
  const ownerNameByCode = useMemo(() => {
    const names = new Map();
    for (const region of regionGeometry.regions) {
      if (region.code && region.country && !names.has(region.code)) {
        names.set(region.code, region.country);
      }
    }
    for (const [code, polity] of Object.entries(worldState?.polityOverrides ?? {})) {
      const resolvedCode = polity?.code || code;
      if (resolvedCode && polity?.name) names.set(resolvedCode, polity.name);
    }
    return names;
  }, [regionGeometry, worldState]);

  // Owners whose territory changed get a freshly recomputed point label; their
  // stale baseline label (point or curved) is dropped. Owners left with no
  // region produce no dynamic label, so they simply vanish from the map.
  const dynamicLabels = useMemo(
    () =>
      buildDynamicOwnerLabels(
        regionGeometry,
        worldState?.regionOwnershipOverrides ?? {},
        (code) => ownerNameByCode.get(code),
      ),
    [regionGeometry, worldState, ownerNameByCode],
  );

  const pointLabelData = useMemo(() => {
    const base = removeFeaturesByCode(rawPointLabelData, dynamicLabels.affectedOwners);
    if (!dynamicLabels.pointFeatures.length) return base;
    return {
      type: "FeatureCollection",
      features: [...base.features, ...dynamicLabels.pointFeatures],
    };
  }, [rawPointLabelData, dynamicLabels]);

  const curvedLabelData = useMemo(
    () => removeFeaturesByCode(rawCurvedLabelData, dynamicLabels.affectedOwners),
    [rawCurvedLabelData, dynamicLabels],
  );

  // Base country color expression (keyed by GID_0), reused by both layers.
  const baseColorByCountry = useMemo(() => {
    const stops = Object.entries(colorMap).flatMap(([iso, rgb]) => [
      iso, `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`,
    ]);
    const fallback = buildFallbackColorExpression();
    return stops.length > 0
      ? ["match", ["get", "GID_0"], ...stops, fallback]
      : fallback;
  }, [colorMap]);

  // The `countries` layer (keyed by GID_0) only paints countries that have NO
  // region geometry. Region-subdivided countries are drawn by the regions layer
  // below, so their base fill is forced transparent — otherwise the two 0.66
  // layers would blend and tint reassigned regions with their former owner.
  const fillStyle = useMemo(() => {
    const coveredStops = [...regionCountryCodes].flatMap((code) => [code, "rgba(0, 0, 0, 0)"]);
    return {
      "fill-color": coveredStops.length > 0
        ? ["match", ["get", "GID_0"], ...coveredStops, baseColorByCountry]
        : baseColorByCountry,
      "fill-opacity": 0.66,
    };
  }, [baseColorByCountry, regionCountryCodes]);

  // The `regions` layer is the authoritative fill for every region: each is
  // colored by its EFFECTIVE owner (override ?? GID_0) so reassigned regions show
  // the pure new-owner color and emptied countries vanish from the map.
  const regionFillStyle = useMemo(() => {
    const overrideStops = Object.entries(worldState?.regionOwnershipOverrides ?? {}).flatMap(([regionId, ownerCode]) => [
      regionId,
      colorMap[ownerCode]
        ? `rgb(${colorMap[ownerCode][0]}, ${colorMap[ownerCode][1]}, ${colorMap[ownerCode][2]})`
        : fallbackColorFromCode(ownerCode),
    ]);

    return {
      "fill-color": overrideStops.length > 0
        ? ["match", ["get", "GID_1"], ...overrideStops, baseColorByCountry]
        : baseColorByCountry,
      "fill-opacity": 0.66,
    };
  }, [baseColorByCountry, colorMap, worldState]);

  const pointLabelLayerLayout = useMemo(() => ({
    "text-field": ["get", "name"],
    "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
    "text-size": buildCountryTextSize(),
    "text-rotate": ["get", "rotation"],
    "text-anchor": "center",
    "text-allow-overlap": true,
    "text-pitch-alignment": "map",
    "text-rotation-alignment": "map",
    "text-keep-upright": false,
  }), []);

  const curvedLabelLayerLayout = useMemo(() => ({
    "text-field": ["get", "glyph"],
    "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
    "text-size": buildCountryTextSize(),
    "text-rotate": ["get", "rotation"],
    "text-anchor": "center",
    "text-allow-overlap": true,
    "text-pitch-alignment": "map",
    "text-rotation-alignment": "map",
    "text-keep-upright": false,
  }), []);

  const labelLayerPaint = useMemo(() => ({
    "text-color": "#FFFFFF",
    "text-halo-color": "rgba(0, 0, 0, 0.5)",
    "text-halo-width": 1,
    "text-opacity": [
      "interpolate", ["linear"], ["zoom"],
      5, 0.75,
      8, 0,
    ],
  }), []);

  return (
    <>
      <Source id="countries-source" type="vector" url={countriesUrl}>
        <Layer
          id="countries-fill"
          type="fill"
          source-layer="countries"
          paint={fillStyle}
        />
        <Layer
          id="countries-outline"
          type="line"
          source-layer="countries"
          paint={{ "line-color": "#000", "line-width": 1 }}
        />
      </Source>

      <Source id="regions-source" type="vector" url={regionsUrl}>
        <Layer
          id="regions-fill"
          type="fill"
          source-layer="regions"
          paint={regionFillStyle}
        />
        <Layer
          id="regions-outline"
          type="line"
          source-layer="regions"
          paint={{
            "line-color": "#000",
            "line-width": [
              "interpolate", ["linear"], ["zoom"],
              3, 0.2,
              8, 0.6,
              12, 1.0,
            ],
            "line-opacity": [
              "interpolate", ["linear"], ["zoom"],
              3, 0,
              4, 0.4,
              8, 0.7,
            ],
          }}
        />
      </Source>

      <Source id="country-curved-label-source" type="geojson" data={curvedLabelData}>
        <Layer
          id="country-curved-labels"
          type="symbol"
          layout={curvedLabelLayerLayout}
          paint={labelLayerPaint}
        />
      </Source>

      <Source id="country-point-label-source" type="geojson" data={pointLabelData}>
        <Layer
          id="country-labels"
          type="symbol"
          layout={pointLabelLayerLayout}
          paint={labelLayerPaint}
        />
      </Source>
    </>
  );
};

export default WorldMap;
