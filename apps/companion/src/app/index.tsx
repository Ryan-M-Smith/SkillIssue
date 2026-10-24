import MotionDebugger from "@/components/motion-debugger";
import { useMotionControl } from "@/service/useMotionControl";

export default function Index() {
    const motion = useMotionControl();

    return <MotionDebugger {...motion} />;
}
