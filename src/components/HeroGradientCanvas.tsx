import { ShaderGradient, ShaderGradientCanvas } from "@shadergradient/react";

/**
 * The WebGL layer itself. Imported lazily by `HeroGradient` so that `three` and
 * `@react-three/fiber` stay out of the initial bundle and never run on the server.
 *
 * Palette is the site's own indigo/violet. It renders at full strength here;
 * `HeroGradient` is what dials it back and holds text contrast over it.
 */
export default function HeroGradientCanvas({
  animate,
}: {
  animate: "on" | "off";
}) {
  return (
    <ShaderGradientCanvas
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      pointerEvents="none"
      pixelDensity={1}
      fov={45}
    >
      <ShaderGradient
        control="props"
        type="waterPlane"
        animate={animate}
        // Slow enough to read as drift rather than motion.
        uSpeed={0.08}
        uStrength={2.6}
        uDensity={1}
        uAmplitude={0}
        uFrequency={5.5}
        uTime={0.2}
        // Camera looks down at the plane with the horizon pushed off the top edge,
        // so the hero gets the soft middle of the wash rather than its skyline.
        cAzimuthAngle={180}
        cPolarAngle={120}
        cDistance={2.9}
        cameraZoom={1}
        positionX={0}
        positionY={1.8}
        positionZ={0}
        rotationX={0}
        rotationY={0}
        rotationZ={-90}
        // white → indigo-200 → violet-100.
        color1="#ffffff"
        color2="#c7d2fe"
        color3="#ede9fe"
        // `3d` lighting keeps this self-contained — no HDR environment fetch.
        lightType="3d"
        brightness={1}
        reflection={0.1}
        // Grain off: at `pixelDensity` 1 it upscales into visible noise on
        // high-DPR phones, and the wash is pale enough not to band without it.
        grain="off"
        enableTransition={false}
      />
    </ShaderGradientCanvas>
  );
}
