//
// Visualization of pipe buffer storage:
//
//   [ write-offset | read-offset | ... byte-array ... ]
//
// The byte array is filled from read-offset to write-offset. It is possible
// for write-offset to be less than read-offset, which implies that we have
// wrapped around.
//
// If "X" represents a used byte, and "." represents an unused byte, we could
// have the following configurations:
//
//   [ XXXXXXXXXX............. ]
//
// Or,
//
//   [ ......XXXXXXXXXX....... ]
//
// Or,
//
//   [ XXXXXX.............XXXX ]
//
// The write-offset is always one index beyond the last element of the used
// portion of the array. The read-offset indicates the index of the first
// used element.
//
class PipeBuffer {
  constructor() {
    this.sab_ = null;
    this.int32_ = null;
  }
  initializeFromSAB(sab) {
    this.sab_ = sab;
    this.int32_ = new Int32Array(this.sab_);
  }
  initialize(size) {
    this.initializeFromSAB(new SharedArrayBuffer(PipeBuffer.kHeaderSize + size));
  }
  get sab() {
    return this.sab_;
  }
  /*
  get int32() {
    return this.int32_;
  }
  get writeOffset() { 
    return Atomics.load(this.int32_, PipeBuffer.kWriteOffset);
  }
  incrementWriteOffset() {
    Atomics.add(this.int32_, 0, 1);
  }
  get readOffset() { 
    return Atomics.load(this.int32_, PipeBuffer.kReadOffset);
  }
  incrementReadCounter() {
    Atomics.add(this.int32_, 1, 1);
  }
  */
  get numBytes() { 
    return this.computeNumBytes_(
        Atomics.load(this.int32_, PipeBuffer.kWriteOffset),
        Atomics.load(this.int32_, PipeBuffer.kReadOffset));
  }
  /*
  set numBytes(value) {
    Atomics.store(this.int32_, 2, value);
  }
  */

  get maxBytes() {
    return this.sab_.byteLength - PipeBuffer.kHeaderSize;
  }

  hasData() {
    return Atomics.load(this.int32_, PipeBuffer.kWriteOffset) !=
           Atomics.load(this.int32_, PipeBuffer.kReadOffset);
  }

  waitForData() {
    for (;;) {
      var writeOffset = Atomics.load(this.int32_, PipeBuffer.kWriteOffset);
      var readOffset = Atomics.load(this.int32_, PipeBuffer.kReadOffset);
      if (writeOffset != readOffset)
        return;
      Atomics.wait(this.buffer_.int32, PipeBuffer.kWriteOffset, writeOffset);
    }
  }

  hasSpace() {
    return this.numBytes < (this.maxBytes - 1);
  }

  waitForSpace() {
    for (;;) {
      var writeOffset = Atomics.load(this.int32_, PipeBuffer.kWriteOffset);
      var readOffset = Atomics.load(this.int32_, PipeBuffer.kReadOffset);
      var numBytes = this.computeNumBytes_(writeOffset, readOffset);
      if (numBytes < (this.maxBytes - 1))
        return;
      Atomics.wait(this.buffer_.int32, PipeBuffer.kReadOffset, readOffset);
    }
  }

  copyBytesOut() {
    // Sample the write offset once. It may advance subsequently, but that's
    // okay as we will only read up to the sampled point.
    var writeOffset = Atomics.load(this.int32_, PipeBuffer.kWriteOffset);
    var readOffset = Atomics.load(this.int32_, PipeBuffer.kReadOffset);

    var num_bytes = this.computeNumBytes_(writeOffset, readOffset);

    var result = new Int8Array(num_bytes);

    if (writeOffset > readOffset) {
      result.set(new Int8Array(this.sab_, PipeBuffer.kHeaderSize + readOffset, num_bytes));
    } else {
      var first_chunk_size = this.maxBytes - readOffset;
      var second_chunk_size = writeOffset;
      if (first_chunk_size > 0)
        result.set(new Int8Array(this.sab_, PipeBuffer.kHeaderSize + readOffset, first_chunk_size));
      if (second_chunk_size > 0)
        result.set(new Int8Array(this.sab_, PipeBuffer.kHeaderSize, second_chunk_size), first_chunk_size);
    }

    // Now we can set the read offset to the write offset as we have caught up.
    Atomics.store(this.int32_, PipeBuffer.kReadOffset, writeOffset);

    // Unblock waitForSpace().
    Atomics.wake(this.buffer_.int32, PipeBuffer.kReadOffset, 1);

    return result;
  }

  copyBytesIn(bytes) {
    // Sample the read offset once. It may advance subsequently, but that's
    // okay as we will only write up to the sampled point.
    var writeOffset = Atomics.load(this.int32_, PipeBuffer.kWriteOffset);
    var readOffset = Atomics.load(this.int32_, PipeBuffer.kReadOffset);

    var num_bytes = this.computeNumBytes_(writeOffset, readOffset);

    // Subtract one to ensure that the write-offset never advances to equal the
    // read-offset.
    var bytes_available = this.maxBytes - num_bytes - 1;

    var bytes_to_copy;
    if (bytes_available < bytes.byteLength) {
      bytes_to_copy = bytes_available;
    } else {
      bytes_to_copy = bytes.byteLength;
    }

    var int8 = new Int8Array(this.sab_, PipeBuffer.kHeaderSize, this.maxBytes);

    if (readOffset > writeOffset || bytes_to_copy < (this.maxBytes - writeOffset)) {
      int8.set(bytes, writeOffset);
      Atomics.store(this.int32_, PipeBuffer.kWriteOffset, writeOffset + bytes_to_copy);
    } else {
      var first_chunk_size = this.maxBytes - writeOffset;
      var second_chunk_size = bytes_to_copy - first_chunk_size;

      if (first_chunk_size > 0)
        int8.set(new Int8Array(bytes.buffer, bytes.byteOffset, first_chunk_size), writeOffset);
      if (second_chunk_size > 0)
        int8.set(new Int8Array(bytes.buffer, bytes.byteOffset + first_chunk_size, second_chunk_size), 0);
      Atomics.store(this.int32_, PipeBuffer.kWriteOffset, second_chunk_size);
    }

    // Unblock waitForData().
    Atomics.wake(this.buffer_.int32, PipeBuffer.kWriteOffset, 1);

    return bytes_to_copy;
  }

  computeNumBytes_(writeOffset, readOffset) {
    if (writeOffset >= readOffset)
      return writeOffset - readOffset;

    // Wrap around case.
    return (this.maxBytes - readOffset) + writeOffset;
  }
}
PipeBuffer.kHeaderSize =
    4 +  // write offset
    4;   // read offset
PipeBuffer.kWriteOffset = 0;
PipeBuffer.kReadOffset = 1;

class PipeReader {
  constructor(buffer) {
    this.buffer_ = buffer;
  }
  read() {  // returns Int8Array, blocking until available
    this.buffer_.waitForData();
    return this.buffer_.copyBytesOut();
  }
  tryRead() {  // returns Int8Array or null
    if (!this.buffer_.hasData())
      return null;
    return this.buffer_.copyBytesOut();
  }
}

class PipeWriter {
  constructor(buffer) {
    this.buffer_ = buffer;
  }
  write(bytes) {  // Blocks until fully written.
    for (;;) {
      var bytes_written = this.tryWrite(bytes);
      if (bytes_written == bytes.byteLength)
        return;
      var offset = bytes.byteOffset + bytes_written;
      var length = bytes.byteLength - bytes_written;
      bytes = new Int8Array(bytes.buffer, offset, length);
      this.buffer_.waitForSpace();
    }
  }
  tryWrite(bytes) {  // Returns number of bytes written.
    return this.buffer_.copyBytesIn(bytes);
  }
}
