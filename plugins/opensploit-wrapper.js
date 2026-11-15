import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const moduleURL = pathToFileURL(
  join(homedir(), ".config", "opencode", "opensploit-plugin", "dist", "index.js")
).href;
const { default: OpenSploitPlugin } = await import(moduleURL);

export default {
  id: "opensploit.core",
  server: OpenSploitPlugin,
};
