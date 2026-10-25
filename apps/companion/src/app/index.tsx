import MotionDebugger from "@/components/motion-debugger";
import { useMotionControl } from "@/hooks/use-motion-control";

export default function Index() {
    const motion = useMotionControl();

    return <MotionDebugger {...motion} />;
}
