import { Suspense, lazy, useEffect, useState } from "react";

const HeroGradientCanvas = lazy(() => import("./HeroGradientCanvas"));

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** Cheap one-off probe: a device with no WebGL gets the CSS wash and nothing else. */
function hasWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      canvas.getContext("webgl2") ??
      canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl"),
    );
  } catch {
    return false;
  }
}

/**
 * Animated hero wash.
 *
 * Three gates before any WebGL runs: client-side only (this whole tree is
 * server-rendered), `prefers-reduced-motion: reduce` honored, and a WebGL
 * capability probe. When any gate closes, the static CSS blobs below stand in —
 * they also paint immediately, so there is no blank frame while the shader
 * chunk downloads.
 *
 * The shader is frozen (`animate="off"`) while the tab is hidden, so it never
 * resumes mid-wave on a stale clock when the tab comes back.
 */
export function HeroGradient() {
  const [enabled, setEnabled] = useState(false);
  const [animate, setAnimate] = useState<"on" | "off">("on");

  useEffect(() => {
    const motion = window.matchMedia(REDUCED_MOTION);

    const sync = () => setEnabled(!motion.matches && hasWebGL());
    sync();
    motion.addEventListener("change", sync);

    const onVisibility = () =>
      setAnimate(document.visibilityState === "visible" ? "on" : "off");
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      motion.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Static wash: the reduced-motion / no-WebGL fallback, and the paint that
          sits under the canvas while it loads. */}
      <div aria-hidden className="absolute inset-0">
        <div className="absolute -top-40 right-0 h-[500px] w-[500px] rounded-full bg-indigo-100 blur-3xl" />
        <div className="absolute -bottom-32 left-0 h-[400px] w-[400px] rounded-full bg-violet-100 blur-3xl" />
      </div>

      {enabled && (
        <Suspense fallback={null}>
          <div aria-hidden className="absolute inset-0 opacity-45">
            <HeroGradientCanvas animate={animate} />
          </div>
        </Suspense>
      )}

      {/* Scrim: holds text contrast over the wash and fades the section into the
          page white so the next one starts clean. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-b from-white/20 via-white/55 to-white"
      />
    </div>
  );
}
