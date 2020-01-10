// Adapted from:
//   https://codereview.stackexchange.com/questions/4005/mutex-and-condition-variable-implementation-using-futex

class Mutex {
  constructor(address) {
    this.address_ = address;
  }

  lock() {
    var m = this.address_;
    var c;
    while ((c = Atomics.compareExchange(m, 0, 0, 1)) != 0)  {
      if ((c == 2) || Atomics.compareExchange(m, 0, 1, 2) != 0)
        Atomics.wait(m, 0, 2);
    }
  }

  unlock() {
    var m = this.address_;
    if(Atomics.sub(m, 0, 1) != 1)  {
      Atomics.store(m, 0, 0);
      Atomics.wake(m, 0, 1);
    }
  }
}

class CondVar {
  constructor(address) {
    this.address_ = address;
  }

  signal() {
    var seq = this.address_;

    Atomics.add(seq, 0, 1);
    Atomics.wake(seq, 0, 1);
  }

  wait(mutex) {
    var seq = this.address_;

    var old_seq = seq[0];

    mutex.unlock();

    var m = mutex.address_;

    Atomics.wait(seq, 0, old_seq);
    while (Atomics.exchange(m, 0, 2))
      Atomics.wait(m, 0, 2);
  }
}
