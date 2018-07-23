#!/usr/bin/bash -e

FILES=\
    src/header.js \
    build/resources.js \
    src/crc32.js \
    src/helpers.js \
    src/tweaks.js \
    src/create_zip.js \
    src/data_sources.js \
    src/encode_mkv.js \
    src/hide_mouse_cursor_on_idle.js \
    src/image_data.js \
    src/on_click_viewer.js \
    src/polyfills.js \
    src/progress_bar.js \
    src/seek_bar.js \
    src/struct.js \
    src/ugoira_downloader_mjpeg.js \
    src/viewer.js \
    src/viewer_images.js \
    src/viewer_muted.js \
    src/viewer_ugoira.js \
    src/zip_image_player.js \
    src/main_ui.js \
    src/tag_search_dropdown_widget.js \
    src/thumbnail_data.js \
    src/thumbnail_view.js \
    src/manga_thumbnail_widget.js \
    src/page_manager.js \
    src/remove_link_interstitial.js \
    src/image_preloading.js \
    src/main.js \
    src/footer.js

all: build

clean:
	rm -f build/*.js

build/resources.js: resources/*
	python create_resources.py > $@

build: build/ppixiv.user.js

build/ppixiv.user.js: $(FILES)
	cat $(FILES) > build/ppixiv.user.js

install: build/ppixiv.user.js
	./install.sh build/ppixiv.user.js

