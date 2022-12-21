
// https://www.pixiv.net/en/#ppixiv/edits
// View images that have edits on them
//
// This views all images that the user has saved crops, etc. for.  This isn't currently
// shown in the UI.
import { DataSourceFakePagination } from 'vview/data-sources/data-source.js';

export default class DataSources_EditedImages extends DataSourceFakePagination
{
    get name() { return "edited"; }
    get includes_manga_pages() { return true; }

    async load_all_results()
    {
        return await ppixiv.extra_image_data.get.get_all_edited_images();
    };

    get page_title() { return "Edited"; }
    get_displaying_text() { return "Edited Images"; }
}
