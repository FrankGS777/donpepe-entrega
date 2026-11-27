"use strict";

// The dock approach remains on a truck after it starts a road trip. Consumers
// must use the active trip and its cursor, never that previous approach route.
function motionGuide(device) {
  if (device.trip?.waypoints?.length > 1)
    return { route: device.trip.waypoints, index: device.trip.guideIndex ?? 1 };
  return { route: device.route || [], index: device.routeIndex ?? 1 };
}

const TRUCK_GUIDE_VERSION = 3;
module.exports = { motionGuide, TRUCK_GUIDE_VERSION };
