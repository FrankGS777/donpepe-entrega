const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const source = fs.readFileSync(
  require("node:path").join(__dirname, "../public/js/scanner.js"),
  "utf8",
);
function setup(fallback = false) {
  const reads = [],
    tracks = {
      stopped: 0,
      stop() {
        this.stopped++;
      },
    };
  const stream = { getTracks: () => [tracks] };
  const controls = {
    stops: 0,
    stop() {
      this.stops++;
    },
  };
  let requested;
  const window = { isSecureContext: true };
  if (fallback)
    window.ZXingBrowser = {
      BrowserMultiFormatReader: class {
        async decodeFromStream(s, v, cb) {
          cb({ getText: () => "EAN-TEST" }, null, controls);
          cb({ getText: () => "DUPLICADO" }, null, controls);
          return controls;
        }
      },
    };
  else
    window.BarcodeDetector = class {
      static async getSupportedFormats() {
        return ["qr_code", "ean_13"];
      }
      async detect() {
        return [{ rawValue: "QR-TEST" }];
      }
    };
  const context = {
    window,
    navigator: {
      mediaDevices: {
        getUserMedia: async (options) => {
          requested = options;
          return stream;
        },
      },
    },
    setTimeout,
    clearTimeout,
    Uint8Array,
    Uint16Array,
    Uint32Array,
    TextEncoder,
    console,
  };
  vm.runInNewContext(source, context);
  const video = { srcObject: null, play: async () => {} };
  return {
    api: window.WmsScanner,
    video,
    tracks,
    reads,
    controls,
    get requested() {
      return requested;
    },
  };
}
test("cámara nativa entrega una lectura y detiene el stream antes de confirmar", async () => {
  const mock = setup();
  mock.api.cameraSession({
    video: mock.video,
    deviceId: "iphone",
    onRead: (raw) => mock.reads.push(raw),
    onError: (error) => {
      throw error;
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(mock.reads, ["QR-TEST"]);
  assert.equal(mock.tracks.stopped, 1);
  assert.equal(mock.requested.video.deviceId.exact, "iphone");
  assert.equal(mock.video.srcObject, null);
});
test("lector alternativo de Safari no duplica lecturas y libera la cámara", async () => {
  const mock = setup(true);
  mock.api.cameraSession({
    video: mock.video,
    onRead: (raw) => mock.reads.push(raw),
    onError: (error) => {
      throw error;
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(mock.reads, ["EAN-TEST"]);
  assert.equal(mock.tracks.stopped, 1);
  assert(mock.controls.stops > 0);
});
test("detener antes del permiso evita que quede una cámara abierta", async () => {
  const mock = setup();
  const session = mock.api.cameraSession({
    video: mock.video,
    onRead: (raw) => mock.reads.push(raw),
    onError: (error) => {
      throw error;
    },
  });
  session.stop();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(mock.reads, []);
  assert.equal(mock.tracks.stopped, 1);
});
