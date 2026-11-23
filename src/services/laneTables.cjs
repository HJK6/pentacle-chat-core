'use strict';
// Static JSON imports are shared with the daemon/fixture tools. The CJS bridge
// also works for Node 22 callers that require workLanes.ts directly.
module.exports = {
  icons: require('../../lane_icons.json').icons,
  hues: require('../../lane_hues.json').palette,
};
