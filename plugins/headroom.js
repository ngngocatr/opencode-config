import { server as headroom } from "opencode-headroom";

export default {
  id: "opencode-headroom",
  server: (input) => headroom(input, {}),
};
