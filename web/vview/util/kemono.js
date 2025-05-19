export async function getKemonoUrl(url, domain) {
	function getFanbox(creatorId) {
		return new Promise((resolve, reject) => {
			fetch(`https://api.fanbox.cc/creator.get?creatorId=${creatorId}`, {
				method: "get",
				credentials: "include",
			})
				.then((r) => {
					if (r.ok) return r.json();
					reject({ status: r.status, statusText: r.statusText });
				})
				.then((data) => resolve(data))
				.catch((e) => reject(e));
		});
	}

	const pixiv_user = /https:\/\/www\.pixiv\.net\/users\/(\d+)/i;
	const pixiv_artworks = /https:\/\/www\.pixiv\.net\/artworks\/(\d+)/i;
	const fantia_user = /https:\/\/fantia\.jp\/fanclubs\/(\d+)(\/posts(\S+))?/i;
	const fanbox_user1 = /https:\/\/www\.fanbox\.cc\/@([^/]+)(\/posts\/(\d+))?/i;
	const fanbox_user2 = /https:\/\/(.+)\.fanbox\.cc(\/posts\/(\d+))?/i;
	const dlsite_user =
		/https:\/\/www.dlsite.com\/.+?\/profile\/=\/maker_id\/(RG\d+).html/i;
	const patreon_user1 = /https:\/\/www.patreon.com\/user\?u=(\d+)/i;
	const patreon_user2 = /https:\/\/www.patreon.com\/(\w+)/i;

	let service;
	let id;
	let post = null;

	if (pixiv_user.test(url)) {
		//pixiv artist
		service = "fanbox";
		id = url.match(pixiv_user)[1];
	} else if (pixiv_artworks.test(url)) {
		//pixiv artworks
		service = "fanbox";
		const artist = document.querySelector("div.sc-f30yhg-2>a.sc-d98f2c-0");
		if (artist) {
			id = artist.href.match(pixiv_user)[1];
		} else {
			window.alert("try get artist id failed");
			return;
		}
	} else if (fantia_user.test(url)) {
		//fantia
		service = "fantia";
		id = url.match(fantia_user)[1];
	} else if (dlsite_user.test(url)) {
		service = "dlsite";
		id = url.match(dlsite_user)[1];
	} else if (fanbox_user1.test(url) || fanbox_user2.test(url)) {
		//fanbox
		service = "fanbox";
		const matches = fanbox_user1.test(url)
			? url.match(fanbox_user1)
			: url.match(fanbox_user2);
		id = (await getFanbox(matches[1])).body.user.userId;
		post = matches[3];
	} else if (patreon_user1.test(url)) {
		// patreon
		service = "patreon";
		id = url.match(patreon_user1)[1];
	} else {
		window.alert("unknown");
		return;
	}

	return (
		`https://${domain}/${service}/user/${id}` +
		(post == null ? "" : `/post/${post}`)
	);
}
