#!/usr/bin/bash -e

FILES=\
    src/header.js \
    src/actions.js \
    src/muting.js \
    src/crc32.js \
    src/helpers.js \
    src/fix_chrome_clicks.js \
    src/widgets.js \
    src/menu_option.js \
    src/main_context_menu.js \
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
    src/view.js \
    src/view_illust.js \
    src/view_search.js \
    src/view_manga.js \
    src/image_ui.js \
    src/tag_search_dropdown_widget.js \
    src/tag_translations.js \
    src/thumbnail_data.js \
    src/manga_thumbnail_widget.js \
    src/page_manager.js \
    src/remove_link_interstitial.js \
    src/image_preloading.js \
    src/whats_new.js \
    src/main.js \
    build/resources.js \
    src/footer.js

all: build

# This is used by create_debug_script.py.
get_all_files:
	@echo $(FILES)

clean:
	rm -f build/*.js

build/ppixiv-debug.user.js: Makefile
	./create_debug_script.py $@

build/resources.js: resources/* inline-resources/*
	python3 create_resources.py $@

build: build/ppixiv.user.js build/ppixiv-debug.user.js

build/ppixiv.user.js: Makefile $(FILES)
	cat $(FILES) > build/ppixiv.user.js

install: build/ppixiv.user.js
	./install.sh build/ppixiv.user.js

