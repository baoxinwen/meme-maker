const outdatedTemplateCaches = new Set([
  "template-data-v2",
  "template-images-v2",
  "template-assets-v3",
]);

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((name) => outdatedTemplateCaches.has(name)).map((name) => caches.delete(name)),
        ),
      ),
  );
});
