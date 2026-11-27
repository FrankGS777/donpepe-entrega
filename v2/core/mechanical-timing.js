"use strict";
// Physical minima for the DonPepe model's distances, not an OEM cycle claim.
// Versioning new authorizations avoids rebasing an already witnessed phase.
const MECHANICAL_TIMING_VERSION = 3;
const SUPPLIER_APPROACH_SECONDS = 12;
const INBOUND_STAGE_MIN_SECONDS = Object.freeze({
  UNLOADING: 12,
  IDENTIFYING: 8,
  INSPECTING: 9,
});
const INBOUND_TRANSFER_MIN_SECONDS = 90;
const STORE_UNLOAD_MIN_SECONDS = 10;
const STORE_DOOR_SECONDS = 1.2;
const stationTransferSeconds = stationId => stationId === "RECEIVE" ? 24 : stationId === "PACK" ? 14 : 2;
module.exports = {
  MECHANICAL_TIMING_VERSION, SUPPLIER_APPROACH_SECONDS, INBOUND_STAGE_MIN_SECONDS,
  INBOUND_TRANSFER_MIN_SECONDS, STORE_UNLOAD_MIN_SECONDS, STORE_DOOR_SECONDS, stationTransferSeconds,
};
