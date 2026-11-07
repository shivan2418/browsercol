package browsercol.shim;

import org.teavm.model.BasicBlock;
import org.teavm.model.ClassHolder;
import org.teavm.model.ClassHolderTransformer;
import org.teavm.model.ClassHolderTransformerContext;
import org.teavm.model.Instruction;
import org.teavm.model.MethodHolder;
import org.teavm.model.MethodReference;
import org.teavm.model.instructions.InvokeInstruction;
import org.teavm.vm.spi.TeaVMHost;
import org.teavm.vm.spi.TeaVMPlugin;

import java.util.Optional;

/**
 * Makes {@code Collectors.minBy}, {@code maxBy} and {@code reducing(op)}
 * give an empty Optional for a null result, as the JDK does (#352,
 * docs/teavm.md).
 *
 * TeaVM 0.16's {@code Collectors.Reducer.getOpt} is
 * {@code present ? Optional.of(value) : Optional.empty()}, so a stream
 * whose minimum is null throws a NullPointerException instead of giving
 * null from {@code .orElse(null)}. FreeCol's {@code CollectionUtils.minimize}
 * does that, and {@code Unit.getClosestColony} puts a null placeholder in
 * its stream: every ship battle whose loser's player had no colony that
 * repairs ships failed in the browser. This turns the {@code Optional.of}
 * in getOpt into {@code Optional.ofNullable}.
 */
public class OptionalReducerFix implements TeaVMPlugin, ClassHolderTransformer {
    private static final String REDUCER_SUFFIX = "Collectors$Reducer";
    private static final MethodReference OF = new MethodReference(Optional.class, "of", Object.class, Optional.class);
    private static final MethodReference OF_NULLABLE = new MethodReference(Optional.class, "ofNullable",
            Object.class, Optional.class);

    @Override
    public void install(TeaVMHost host) {
        host.add(this);
    }

    @Override
    public void transformClass(ClassHolder cls, ClassHolderTransformerContext context) {
        if (!cls.getName().endsWith(REDUCER_SUFFIX)) {
            return;
        }
        boolean changed = false;
        for (MethodHolder method : cls.getMethods()) {
            if (!method.getName().equals("getOpt") || method.getProgram() == null) {
                continue;
            }
            for (int i = 0; i < method.getProgram().basicBlockCount(); ++i) {
                BasicBlock block = method.getProgram().basicBlockAt(i);
                for (Instruction insn : block) {
                    if (insn instanceof InvokeInstruction invoke && invoke.getMethod().equals(OF)) {
                        invoke.setMethod(OF_NULLABLE);
                        changed = true;
                    }
                }
            }
        }
        if (!changed) {
            throw new IllegalStateException("OptionalReducerFix: " + cls.getName()
                    + ".getOpt has an unexpected shape; check it against this TeaVM version");
        }
    }
}
