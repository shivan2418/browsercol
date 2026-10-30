package online.freecol.shim;

import org.teavm.model.BasicBlock;
import org.teavm.model.ClassHolder;
import org.teavm.model.ClassHolderTransformer;
import org.teavm.model.ClassHolderTransformerContext;
import org.teavm.model.Instruction;
import org.teavm.model.MethodHolder;
import org.teavm.model.Program;
import org.teavm.model.instructions.InvokeInstruction;
import org.teavm.model.instructions.PutFieldInstruction;
import org.teavm.vm.spi.TeaVMHost;
import org.teavm.vm.spi.TeaVMPlugin;

/**
 * Makes Object.wait work under TeaVM 0.16 Wasm GC (#11, spike/README.md,
 * "Why Object.wait hangs").
 *
 * TeaVM's Fiber.suspend marks the fiber as suspending and then calls
 * call.run(callback), which starts the async operation. For Object.wait that
 * is waitImpl: queue the waiter, set the timer, release the monitor. Wasm GC
 * coroutine code treats "the fiber is suspending" after any call to a method
 * that may suspend as "the callee suspended", and unwinds. In a large program
 * most methods may suspend (any exception constructor reaches Class.getName,
 * which is async through virtual StringBuilder calls), so waitImpl unwound at
 * its first such call, ArrayDeque.addLast, before it set the timer or released
 * the monitor. The wait never returned.
 *
 * This moves the {@code fiber.state = STATE_SUSPENDING} store in
 * Fiber.suspend to just after {@code call.run(...)}. A complete() made
 * synchronously inside call.run still works: it sets isPendingResume, and
 * Fiber.start resumes the fiber once the stack has unwound.
 */
public class FiberSuspendFix implements TeaVMPlugin, ClassHolderTransformer {
    private static final String FIBER = "org.teavm.runtime.Fiber";

    @Override
    public void install(TeaVMHost host) {
        host.add(this);
    }

    @Override
    public void transformClass(ClassHolder cls, ClassHolderTransformerContext context) {
        if (!cls.getName().equals(FIBER)) {
            return;
        }
        for (MethodHolder method : cls.getMethods()) {
            if (method.getName().equals("suspend") && method.getProgram() != null) {
                if (!moveStateStore(method.getProgram())) {
                    throw new IllegalStateException("FiberSuspendFix: Fiber.suspend has an unexpected shape;"
                            + " check it against this TeaVM version");
                }
            }
        }
    }

    private static boolean moveStateStore(Program program) {
        PutFieldInstruction store = null;
        InvokeInstruction run = null;
        for (int i = 0; i < program.basicBlockCount(); ++i) {
            BasicBlock block = program.basicBlockAt(i);
            for (Instruction insn : block) {
                if (insn instanceof PutFieldInstruction put
                        && put.getField().getClassName().equals(FIBER)
                        && put.getField().getFieldName().equals("state")
                        && run == null) {
                    store = put; // the last store before call.run
                } else if (insn instanceof InvokeInstruction invoke
                        && invoke.getMethod().getClassName().equals(FIBER + "$AsyncCall")
                        && invoke.getMethod().getName().equals("run")) {
                    run = invoke;
                }
            }
        }
        if (store == null || run == null || store.getBasicBlock() != run.getBasicBlock()) {
            return false;
        }
        store.delete();
        run.insertNext(store);
        return true;
    }
}
