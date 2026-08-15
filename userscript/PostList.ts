import van from "vanjs-core"

import { type PostList, fetchPostList } from "./api/post-list"
import clsx from "./clsx"
import { tags } from "./state"

const { div, img } = van.tags

export function PostList() {
    const postList = van.derive<PostList | null>(() => {
        fetchPostList(tags.val).then((list) => (postList.val = list))
        return null
    })

    return div(() =>
        postList.val
            ? div(
                  { class: clsx("flex flex-wrap") },
                  postList.val.posts.map((post) => div(img({ src: post.thumbnail }))),
              )
            : div("Loading ..."),
    )
}
