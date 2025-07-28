import "./styles.ts";

import { Favorites } from "./favorites";
import { postList } from "./post_list.ts";
import { post } from "./post.ts";

function dispatch() {
  const search = new URLSearchParams(location.search);
  switch (search.get("page")) {
    case "favorites": {
      new Favorites();
      break;
    }
    case "post": {
      switch (search.get("s")) {
        case "list": {
          postList();
          break;
        }
        case "view": {
          post();
          break;
        }
      }
      break;
    }
  }
}

dispatch();
