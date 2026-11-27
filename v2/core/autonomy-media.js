"use strict";

// A class illustration is never represented as an OEM photograph, an installed
// serialised device or evidence that its physical integration has been certified.
const AUTONOMY_MEDIA_TYPES = Object.freeze([
  "AUTO_UNLOADER",
  "AUTO_ID_GATE",
  "PIE_STATION",
  "INBOUND_CONVEYOR",
  "CASE_PICKING_CELL",
  "STORE_RECEIVING_STATION",
]);
const AUTONOMY_MEDIA_VERSION = 1;

function autonomyAssetMedia(type) {
  if (!AUTONOMY_MEDIA_TYPES.includes(type)) return null;
  return {
    imageUrl: `/images/representations/equipment-${type.toLowerCase()}.webp`,
    imageKind: "GENERATED_REPRESENTATION",
    imageScope: "AUTONOMOUS_EQUIPMENT_CLASS_REPRESENTATION",
    imageProvenance: {
      source: "AI_GENERATED",
      scope: "EQUIPMENT_CLASS_VISUALIZATION",
      actualDevicePhoto: false,
      assetType: type,
      resourceVersion: AUTONOMY_MEDIA_VERSION,
    },
  };
}

function migrateSeededAutonomyMedia(asset, type) {
  // Upgrade only the exact technical placeholder installed by our original
  // additive migration. A user-selected/uploaded photo is always authoritative.
  if (
    asset.type !== type ||
    asset.imageUrl !== "/images/automation-cell.svg" ||
    asset.imageKind !== "TECHNICAL_ILLUSTRATION" ||
    asset.imageScope !== "LOGICAL_AUTOMATION_INFRASTRUCTURE" ||
    asset.integrationMode !== "SIMULATED"
  )
    return false;
  const media = autonomyAssetMedia(type);
  if (!media) return false;
  Object.assign(asset, media);
  return true;
}

module.exports = {
  AUTONOMY_MEDIA_TYPES,
  AUTONOMY_MEDIA_VERSION,
  autonomyAssetMedia,
  migrateSeededAutonomyMedia,
};
