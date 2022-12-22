
// https://www.pixiv.net/en/#ppixiv/edits
// View images that have edits on them
//
// This views all images that the user has saved crops, etc. for.  This isn't currently
// shown in the UI.
import { DataSourceFakePagination } from 'vview/data-sources/data-source.js';

export default class DataSources_EditedImages extends DataSourceFakePagination
{
    get name() { return "edited"; }
    get pageTitle() { return "Edited"; }
    getDisplayingText() { return "Edited Images"; }

    // This can return manga pages directly, so don't allow expanding pages.
    get allowExpandingMangaPages() { return false; }

    async loadAllResults()
    {
        return await ppixiv.extraImageData.get_all_edited_images();
    }
}
