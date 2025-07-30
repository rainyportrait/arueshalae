import { filterPostIds, sendPostIds } from "./api";
import { fetchDocument, getIdsFromDOM } from "./fetcher";

export function postList() {
  highlightFavoritedPosts();
  addFavoriteButton();
}

async function highlightFavoritedPosts() {
  const listIds = getIdsFromDOM(document);
  const filteredIds = await filterPostIds(listIds);
  for (const id of filteredIds) {
    highlightPost(id);
  }
}

function highlightPost(id: number) {
  document.querySelector(`#p${id} > img`)?.classList.add("arue-favorited-post");
}

let _userId = 0;
async function getUserID(): Promise<number> {
  if (_userId) {
    return _userId;
  }

  const document = await fetchDocument(
    `https://rule34.xxx/index.php?page=account&s=home`,
  );
  const favoritesUrl = document
    .querySelector('a[href*="index.php?page=favorites"]')
    ?.getAttribute("href");
  if (!favoritesUrl) {
    throw "Could not get favorites url";
  }

  let idParam = new URLSearchParams(favoritesUrl).get("id");
  if (!idParam) {
    throw "Could not get id from favorites link";
  }

  _userId = Number.parseInt(idParam, 10);
  return _userId;
}

async function addFavoriteButton() {
  for (const thumb of document.querySelectorAll(".thumb")) {
    const idString = thumb.getAttribute("id")?.slice(1);
    if (!idString) {
      throw "Could not get id from thumb";
    }

    const container = document.createElement("div");
    container.innerHTML = `<a href="javascript:void()">Add to favorites</a>`;
    container.addEventListener("click", async () => {
      // r34 global functions
      window.post_vote(idString, "up");
      window.addFav(idString);

      // TODO: Ensure that all favorites have already been added to the database
      // before sending this one.

      // special sauce
      const id = Number.parseInt(idString, 10);
      await sendPostIds([id]);
      highlightPost(id);
    });
    thumb.appendChild(container);
  }
}
