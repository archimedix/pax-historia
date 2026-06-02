// Lightweight bus that decouples the map layer from the Admin panel.
//
// Mirrors the module-singleton pattern already used by Selection/Regions.jsx:
// the map never imports the panel, it just consults the flag and emits picks.
// When admin mode is active, a region click on the map is routed to the panel
// (as a "source" selection) instead of opening the normal region popup.

let adminActive = false;
let regionHandler = null;

export const setAdminActive = (active) => {
  adminActive = Boolean(active);
};

export const isAdminActive = () => adminActive;

// The Admin panel registers the callback that receives map region clicks.
// Returns an unsubscribe function for use in a React effect cleanup.
export const registerAdminRegionHandler = (handler) => {
  regionHandler = typeof handler === "function" ? handler : null;
  return () => {
    if (regionHandler === handler) {
      regionHandler = null;
    }
  };
};

// Called by the map on a region click while admin mode is active.
export const emitAdminRegionPick = (payload) => {
  regionHandler?.(payload);
};
