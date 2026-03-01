import { helpers } from '/vview/misc/helpers.js';

export async function importAllData()
{
    // This API is annoying: it throws an exception (rejects the promise) instead of
    // returning null.  Exceptions should be used for unusual errors, not for things
    // like the user cancelling a file dialog.
    let files;
    try {
        files = await window.showOpenFilePicker({
            multiple: false,
            types: [{
                description: 'Exported ppixiv data',
                accept: {
                    'application/json': ['.json'],
                }
            }],
        });
    } catch(e) {
        return;
    }

    let file = await files[0].getFile();
    let entries = JSON.parse(await file.text());

    // Check if this is just iamge edits, which is what we used to export.
    if(entries.type == "ppixiv-image-data")
    {
        entries = {
            type: "ppixiv-export",
            data: [{
                type: "image-data",
                data: entries.data,
            }],
        };
    }

    if(entries.type != "ppixiv-export")
    {
        ppixiv.message.show(`The file "${file.name}" doesn't contain exported ppixiv data.`);
        return;
    }

    for(let { type, data } of entries.data)
    {
        switch(type)
        {
        case "image-data":
            let { count } = await ppixiv.extraImageData.import(data);
            console.log(`Imported edits for ${count} ${count == 1? "image":"images"}.`);
            break;
        case "settings":
            data = new Map(Object.entries(data));
            ppixiv.settings.setAll(new Map(data));
            console.log(`Imported ${Object.keys(data).length} settings.`);
            break;
        default:
            console.log(`Unknown data type "${type}" in imported data, skipping.`, data);
            break;
        }
    }

    ppixiv.message.show(`Imported data.`);
}

export async function exportAllData()
{
    let exportedItems = [];

    let imageEdits = await ppixiv.extraImageData.export();
    if(imageEdits.length > 0)
    {
        exportedItems.push({
            type: "image-data",
            data: imageEdits,
        });
    }
    
    let settings = ppixiv.settings.getAll();
    exportedItems.push({
        type: "settings",
        data: Object.fromEntries(settings),
    });

    // Wrap the data at the top level so we can detect the file type.
    let exportedData = {
        type: "ppixiv-export",
        data: exportedItems,
    };

    let json = JSON.stringify(exportedData, null, 4);
    let blob = new Blob([json], { type: "application/json" });
    helpers.saveBlob(blob, "ppixiv export.json");
}
