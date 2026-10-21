#!/usr/bin/env bash
set -euo pipefail

echo "=== LIBALSTAL CREATIVE STACK ==="

test -f package.json || {
  echo "ERROR: Run from Vite project root."
  exit 1
}

node -v
npm -v

# 1. Create Claude skills
mkdir -p .claude/skills

python3 - <<'PY'
from pathlib import Path

skills = {
"threejs-expert": "Build professional Three.js scenes, cameras, lighting, shaders, realistic PBR materials, and interactive 3D experiences. Optimize geometry, GPU resources, and responsive rendering.",
"react-three-fiber": "Build reusable React Three Fiber and Drei components. Integrate GLB models, Suspense, loading states, TypeScript, scene cleanup, and optimized React rendering.",
"gsap-motion": "Create cinematic GSAP timelines, ScrollTrigger animations, scroll-driven camera movement, and coordinated transitions. Use React lifecycle cleanup and reduced-motion support.",
"blender-pipeline": "Design Blender-to-web pipelines. Optimize GLB/glTF exports, geometry, UVs, PBR textures, baked animations, lighting, and mobile asset budgets.",
"creative-ui-ux": "Design premium responsive websites with strong typography, visual hierarchy, accessible navigation, professional layout systems, and consistent brand identity.",
"webgl-performance": "Audit and optimize WebGL performance, draw calls, texture memory, shadows, postprocessing, loading, device pixel ratios, and mobile GPU performance.",
"motion-design": "Create refined Motion for React animations, spring transitions, hover effects, interactive menus, and accessible layout transitions.",
"frontend-quality": "Audit React, TypeScript, Vite, accessibility, SEO, security, testing, production builds, Git changes, and deployment readiness.",
"remotion-expert": "Build frame-accurate Remotion video compositions using React, TypeScript, interpolate, spring, useCurrentFrame, and useVideoConfig. Integrate 3D assets and plan reliable rendering workflows.",
"creative-director": "Coordinate Three.js, Blender, GSAP, Motion, Remotion, typography, storytelling, lighting, and art direction into one consistent cinematic brand experience."
}

for name, description in skills.items():
    folder = Path(".claude/skills") / name
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / "SKILL.md"
    if path.exists():
        print("PRESERVED:", name)
        continue

    path.write_text(
        f"---\n"
        f"name: {name}\n"
        f"description: {description}\n"
        f"---\n\n"
        f"# {name}\n\n"
        f"Act as a senior specialist in this discipline.\n\n"
        f"## Responsibilities\n"
        f"{description}\n\n"
        f"## Working rules\n"
        f"- Inspect the existing project first.\n"
        f"- Preserve working functionality.\n"
        f"- Use maintainable, modular code.\n"
        f"- Prioritize mobile performance.\n"
        f"- Respect accessibility and reduced motion.\n"
        f"- Check compatibility before installing packages.\n"
        f"- Validate changes before deployment.\n"
        f"- Request approval for major architectural changes.\n"
    )
    print("CREATED:", name)
PY

# 2. Inspect framework
echo "=== FRAMEWORK CHECK ==="

node - <<'JS'
const p = require('./package.json');
const d = {...p.dependencies, ...p.devDependencies};
console.log("React:", d.react || "not installed");
console.log("Vite:", d.vite || "not installed");
JS

# 3. Install 3D libraries only for React
if node -e "const p=require('./package.json');process.exit((p.dependencies?.react||p.devDependencies?.react)?0:1)"; then
  echo "React detected."

  npm install three gsap @gsap/react motion

  npm install @react-three/fiber @react-three/drei

  npm install -D @types/three
else
  echo "Non-React project detected."
  echo "Installing framework-independent libraries."
  npm install three gsap
  echo "React libraries skipped to avoid changing architecture."
fi

# 4. Create separate Remotion workspace
echo "=== REMOTION WORKSPACE ==="

mkdir -p video-studio

cat > video-studio/README.md <<'EOF'
# Libalstal Video Studio

Dedicated workspace for cinematic Remotion videos.

Planned technologies:
- Remotion
- React
- TypeScript
- Remotion Three
- Blender GLB assets

Initialize this workspace after verifying the
Node.js and Remotion compatibility requirements.

Do not modify the existing Vite website.
EOF

# 5. Verify
echo "=== VERIFICATION ==="

find .claude/skills -name SKILL.md | sort

echo "Total skills:"
find .claude/skills -name SKILL.md | wc -l

echo "=== COMPLETE ==="
echo "Review git diff before committing."
