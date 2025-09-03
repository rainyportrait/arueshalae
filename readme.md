# arueshalae

userscript & api server for downloading favorited posts from rule34.xxx

## build requirements

- [a rust compiler (msrv: 1.85.1)](https://rustup.rs/)
- [nodejs (tested version: v22)](https://nodejs.org/en) with [npm](https://www.npmjs.com/)

## runtime requirements

- [ffmpeg command line](https://ffmpeg.org/)
- [libvips command line](https://www.libvips.org/)

any recent version of those should work.

## usage

1. start the api server (optionally add a path for the api server to store the files in)
2. install the compiled userscript in your browser (tested with firefox and [violentmonkey](https://violentmonkey.github.io/))
3. the userscript should add new buttons to the favorite page
