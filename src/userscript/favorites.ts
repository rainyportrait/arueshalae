import { getApiPostCount, sendPostIds } from "./api";
import { fetchDocument, getIdsFromDOM } from "./fetcher";

const POSTS_PER_PAGE = 50;

export class Favorites {
  private header: HTMLElement;
  private container: HTMLElement;
  private button: HTMLElement;

  constructor() {
    const header = document.querySelector("#header");
    if (!header || !(header instanceof HTMLElement)) {
      throw "Could not find header";
    }
    this.header = header;

    this.container = document.createElement("div");
    this.container.classList.add("arue-container");
    this.header.appendChild(this.container);

    this.button = document.createElement("button");
    this.button.innerHTML = "Sync";
    this.button.addEventListener("click", () => {
      this.sync();
    });
    this.button.classList.add("arue-btn");
    this.container.appendChild(this.button);
  }

  private async sync() {
    const totalFavorites = await this.getTotalFavorites();
    const serverApiCount = await getApiPostCount();

    let postsOutstanding = totalFavorites - serverApiCount;
    while (postsOutstanding > 0) {
      const pid = Math.max(0, postsOutstanding - POSTS_PER_PAGE);
      const postIds = await this.getIdsFromPage(pid);
      await sendPostIds(postIds);
      postsOutstanding -= 50;
    }
  }

  private _userId: string | undefined;
  private getUserId(): string {
    if (this._userId) {
      return this._userId;
    }

    const id = new URLSearchParams(location.search).get("id");
    if (!id) {
      throw "Could not get user id from url";
    }

    return id;
  }

  private _totalFavorites: number | undefined;
  private async getTotalFavorites(): Promise<number> {
    if (this._totalFavorites) {
      return this._totalFavorites;
    }

    const url = `/index.php?page=account&s=profile&id=${this.getUserId()}`;
    const document = await fetchDocument(url);
    const element = document.querySelector(
      'a[href*="index.php?page=favorites&s=view&id="]',
    );
    if (!element || !(element instanceof HTMLElement)) {
      throw "Could not find favorites count";
    }

    // The count on the account page is off by 1 in my test.
    const count = Number.parseInt(element.innerText, 10) + 1;
    this._totalFavorites = count;
    return count;
  }

  private async getIdsFromPage(pid: number): Promise<number[]> {
    const dom = await fetchDocument(
      `/index.php?page=favorites&s=view&id=${this.getUserId()}&pid=${pid}`,
    );
    return getIdsFromDOM(dom);
  }
}
