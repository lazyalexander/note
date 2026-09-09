# How to write a new post

1. Add `NN-title.md` under `posts/` (numeric prefix sets order).
2. First line is the H1 title.
3. Add a sibling `NN-title.json` for metadata (tags and future fields):

```json
{
  "tags": ["guide", "meta"]
}
```

4. Push to `main` — GitHub Actions builds and publishes.
