const roles = ["help", "about", "blog"];
const roleOf = (value, fallback = "blog") => roles.includes(value) ? value : fallback;

/** Presentation roles never move posts, change URLs, or reduce the global search scope. */
export function partitionHomeSeries(series) {
  const groups = { help: [], about: [], blog: [] };
  for (const folder of series) {
    const folderRole = roleOf(folder.homeRole);
    if (!folder.posts.length) { groups[folderRole].push(folder); continue; }
    for (const role of roles) {
      const posts = folder.posts.filter((post) => roleOf(post.meta?.homeRole, folderRole) === role);
      if (posts.length) groups[role].push(posts.length === folder.posts.length ? folder : { ...folder, posts });
    }
  }
  return groups;
}
