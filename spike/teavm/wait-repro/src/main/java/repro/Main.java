package repro;

/**
 * Object.wait(110) on the main thread never returns under TeaVM Wasm GC
 * once any exception constructor may suspend. Here that is a reachable,
 * never-run exception class whose fillInStackTrace sleeps. Expected output:
 * "wait returned after ~110ms". Actual: nothing; Node exits at once with no
 * timer pending.
 */
public class Main {
    public static void main(String[] args) throws Exception {
        if (args.length > 0) { // never true: only makes SlowException reachable
            throw new SlowException();
        }
        Object lock = new Object();
        long t = System.currentTimeMillis();
        synchronized (lock) {
            lock.wait(110);
        }
        System.out.println("wait returned after " + (System.currentTimeMillis() - t) + "ms");
    }

    static class SlowException extends RuntimeException {
        @Override
        public Throwable fillInStackTrace() {
            try {
                Thread.sleep(1);
            } catch (InterruptedException e) {
                // ignore
            }
            return this;
        }
    }
}
