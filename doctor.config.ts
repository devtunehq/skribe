import { defineConfig } from "react-doctor/api";

export default defineConfig({
  ignore: {
    overrides: [
      {
        files: ["web/**"],
        rules: ["deslop/unused-file"]
      },
      {
        files: ["web/ds/_ds_bundle.js"],
        rules: ["react-doctor/button-has-type"]
      }
    ]
  }
});
