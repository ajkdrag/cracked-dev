// The files the pages load, by URL path. The server serves them and the static
// build copies them.
export const staticFiles = {
  "/static/portal.css": ["static/portal.css", "text/css"],
  "/static/portal.js": ["static/portal.js", "text/javascript"],
  "/static/search.mjs": ["search.mjs", "text/javascript"],
  "/vendor/bulma.css": ["node_modules/bulma/css/bulma.min.css", "text/css"],
  "/vendor/htmx.js": [
    "node_modules/htmx.org/dist/htmx.min.js",
    "text/javascript",
  ],
};
