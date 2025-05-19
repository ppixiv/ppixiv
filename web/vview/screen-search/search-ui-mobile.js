import Widget from "/vview/widgets/widget.js";
import { AvatarWidget } from "/vview/widgets/user-widgets.js";
import { helpers } from "/vview/misc/helpers.js";

export default class SearchUIMobile extends Widget {
	constructor({ ...options } = {}) {
		super({
			...options,
			template: `
                <div class=search-ui-mobile>
                    <div class=avatar-container style="float: right;"></div>

                    <div class=search-title></div>
                    <div class=data-source-ui style='margin: auto;'></div>
                </div>
            `,
		});

		this.avatarWidget = new AvatarWidget({
			container: this.querySelector(".avatar-container"),

			// Disable the avatar widget unless the data source enables it.
			visible: false,
		});
	}

	setDataSource(dataSource) {
		if (this._currentDataSourceUi) {
			this._currentDataSourceUi.shutdown();
			this._currentDataSourceUi = null;
		}

		this.dataSource = dataSource;
		this.avatarWidget.setUserId(null);
		this.avatarWidget.visible = false;

		if (dataSource == null) return;

		// Create the new data source's UI.
		if (this.dataSource?.ui) {
			this._currentDataSourceUi = new this.dataSource.ui({
				dataSource: this.dataSource,
				container: this.querySelector(".data-source-ui"),
			});
		}
	}

	refreshUi() {
		if (this.dataSource) {
			let { userId } = this.dataSource.uiInfo;

			this.avatarWidget.visible = userId != null;
			this.avatarWidget.setUserId(userId);
		}

		let elementTitle = this.querySelector(".search-title");
		elementTitle.hidden = this.dataSource?.getDisplayingText == null;
		if (this.dataSource?.getDisplayingText != null) {
			let text = this.dataSource?.getDisplayingText();
			elementTitle.replaceChildren(text);
		}
	}

	applyVisibility() {
		helpers.html.setClass(this.root, "shown", this._visible);
	}
}
