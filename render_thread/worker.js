importScripts("pipe2.js");

function sleep(msec) {
  var sab = new SharedArrayBuffer(4);
  var int32 = new Int32Array(sab);
  Atomics.wait(int32, 0, 0, msec);
}

onmessage = function(e) {
	console.log("message received: " + e.data[0]);

	var sab0 = e.data[1];
	console.log("sab0.byteLength=" + sab0.byteLength);

  var pipe0_buffer = new PipeBuffer();
  pipe0_buffer.initializeFromSAB(sab0);
  var pipe0_reader = new MessagePipeReader(pipe0_buffer);

	var sab1 = e.data[2];
	console.log("sab1.byteLength=" + sab1.byteLength);

  var pipe1_buffer = new PipeBuffer();
  pipe1_buffer.initializeFromSAB(sab1);
  var pipe1_writer = new MessagePipeWriter(pipe1_buffer);

  var image_size = Math.round(Math.sqrt(pipe1_buffer.maxBytes / 4));
  if ((image_size * image_size * 4) != pipe1_buffer.maxBytes)
    console.log("warning: pipe1_buffer.maxBytes is unexpected size");

  for (;;) {
    //console.log("waiting...");
    var int8 = pipe0_reader.read();
    var json = new TextDecoder('utf-8').decode(int8);
    var data = JSON.parse(json);
    //console.log("received (len=" + int8.byteLength + "): x=" + data.x + ", y=" + data.y);

    var r = Math.round(data.x / 1000.0 * 255);
    var g = Math.round(data.y / 1000.0 * 255);

    // RGBA
    //var pixel = r << 24 | g << 16 | 0xFFFFFFFF;

    // TODO: write directly into shared memory?
    var pixel_array = new Uint8Array(image_size * image_size * 4);
    for (var i = 0; i < pixel_array.length; i += 4) {
      pixel_array[i + 0] = r;
      pixel_array[i + 1] = g;
      pixel_array[i + 2] = 0;
      pixel_array[i + 3] = 255;
    }

    pipe1_writer.write(new Int8Array(pixel_array.buffer));

    //console.log("sleeping for 100 msec...");
    //sleep(100);
  }
}
