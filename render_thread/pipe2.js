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
//   [ XXXXXXX............XXXX ]
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
      if (first_chunk_size)
        result.set(new Int8Array(this.sab_, PipeBuffer.kHeaderSize + readOffset, first_chunk_size));
      if (second_chunk_size)
        result.set(new Int8Array(this.sab_, PipeBuffer.kHeaderSize, second_chunk_size), first_chunk_size);
    }

    // Now we can set the read offset to the write offset as we have caught up.
    Atomics.store(this.int32_, PipeBuffer.kReadOffset, writeOffset);

    return result;
  }

  copyBytesIn(bytes) {
    var int8 = new Int8Array(this.sab_, PipeBuffer.kHeaderSize, bytes.byteLength);
    int8.set(bytes);
    this.numBytes = bytes.byteLength;
  }

  computeNumBytes_(writeOffset, readOffset) {
    if (writeOffset > readOffset)
      return writeOffset - readOffset;

    // Wrap around case.
    return (maxBytes - readOffset) + writeOffset;
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
    this.waitForNewInput_();
    var result = this.buffer_.copyBytesOut();
    this.buffer_.incrementReadCounter();
    return result;
  }
  tryRead() {  // returns Int8Array or null
    if (this.buffer_.writeCounter == this.buffer_.readCounter)
      return null;
    var result = this.buffer_.copyBytesOut();
    this.buffer_.incrementReadCounter();
    return result;
  }
  waitForNewInput_() {
    while (this.buffer_.writeCounter == this.buffer_.readCounter)
      Atomics.wait(this.buffer_.int32, 0, this.buffer_.readCounter);
  }
}

class PipeWriter {
  constructor(buffer) {
    this.buffer_ = buffer;
    this.send_queue_ = new Array();
  }
  write(bytes) {
    var maxBytes = this.buffer_.maxBytes;
    if (bytes.byteLength > maxBytes) {
      throw "oops: message is too long to send!";
    } else {
      this.send_queue_.push(bytes);
    }
    this.doPendingWrites();
  }
  hasPendingWrites() {
    return this.send_queue_.length > 0;
  }
  doPendingWrites() {
    while (this.hasPendingWrites()) {
      if (!this.trySendNext_())
        break;
    }
  }
  trySendNext_() {
    if (this.buffer_.writeCounter != this.buffer_.readCounter)
      return false;  // Waiting for reader
    var bytes = this.send_queue_.pop();
    this.buffer_.copyBytesIn(bytes);
    this.buffer_.incrementWriteCounter();
    Atomics.wake(this.buffer_.int32, 0, 1);
    return true;
  }
}
