// Remotion CLI settings for the LIBALSTAL welcome intro.
// The duct scene is real WebGL (three.js), so headless Chrome needs a GL backend:
// "angle" works on Windows/macOS/Linux desktops; on a GPU-less Linux server use "swangle" (software, slower).
import { Config } from '@remotion/cli/config';

Config.setChromiumOpenGlRenderer('angle');
Config.setVideoImageFormat('png');      // lossless frames → no double compression before the final encode
Config.setPixelFormat('yuv420p');       // plays everywhere (Safari/iOS included)
Config.setConcurrency(2);               // each tab owns a WebGL context; keep it modest
Config.setOverwriteOutput(true);
