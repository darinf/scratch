var worker;
var canvas_context;
var pipe0_writer;  // input
var pipe1_reader;  // rendering

const kCanvasWidth = 200;
const kCanvasHeight = 200;

function Start() {
  var canvas = document.createElement("canvas");
  canvas.setAttribute("width", kCanvasWidth);
  canvas.setAttribute("height", kCanvasHeight);
  document.body.appendChild(canvas);
  canvas_context = canvas.getContext("2d");

  var pipe0_buffer = new PipeBuffer();
  pipe0_buffer.initialize(1024);
  pipe0_writer = new PipeWriter(pipe0_buffer);

  var pipe1_buffer = new PipeBuffer();
  pipe1_buffer.initialize(kCanvasWidth * kCanvasHeight * 4);
  pipe1_reader = new PipeReader(pipe1_buffer);

	worker = new Worker("worker.js");
	worker.postMessage(["start", pipe0_buffer.sab, pipe1_buffer.sab]);
  
  ScheduleRenderFrame();
}

function SendData(bytes) {
  //console.log("sending: " + bytes.toString());
  pipe0_writer.tryWrite(bytes);
}

function RenderFrame() {
  //XXX pipe0_writer.doPendingWrites();

  var int8 = pipe1_reader.tryRead();
  if (int8) {
    var uint8 = new Uint8Array(int8.buffer);
    var image_data = canvas_context.createImageData(kCanvasWidth, kCanvasHeight);
    for (var i = 0; i < image_data.data.length; i += 4) {
      image_data.data[i + 0] = uint8[i + 0];
      image_data.data[i + 1] = uint8[i + 1];
      image_data.data[i + 2] = uint8[i + 2];
      image_data.data[i + 3] = uint8[i + 3];
    }
    canvas_context.putImageData(image_data, 0, 0);
  }

  ScheduleRenderFrame();
}

function ScheduleRenderFrame() {
  window.requestAnimationFrame(RenderFrame);
}

var last_x, last_y;

window.addEventListener("mousemove", function(e) {
  if (e.x == last_x && e.y == last_y)
    return;
  last_x = e.x;
  last_y = e.y;

  //console.log("mousemove [x=" + e.x + ", y=" + e.y + "]");
  /*
  var int32 = new Int32Array(2);
  int32[0] = e.x;
  int32[1] = e.y;
  SendData(new Int8Array(int32.buffer));
  */

  var str = JSON.stringify({x: e.x, y: e.y});
  SendData(new TextEncoder().encode(str));

}, false);
