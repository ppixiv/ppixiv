import argparse, base64, collections, errno, hashlib, mimetypes, json, os, random, re, sys, string, subprocess, tempfile
import urllib.parse
from . import util
from pathlib import Path
from pprint import pprint

# This builds a user script that imports each filename directly from the build
# tree.  This can be used during development: you can edit files and refresh a
# page without having to build the script or install it.

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/scss", ".scss")
mimetypes.add_type("application/x-font-woff", ".woff")


def _root_path():
    return Path(os.getcwd())


class BuildError(Exception):
    pass


_git_tag = None


def get_git_tag():
    """
    Return the current git tag.
    """
    global _git_tag
    if _git_tag is not None:
        return _git_tag

    result = subprocess.run(
        ["git", "describe", "--tags", "--dirty", "--match=r*"], capture_output=True
    )
    _git_tag = result.stdout.strip().decode()

    # Work around TamperMonkey's broken attempts at parsing versions: it interprets a
    # standard git devel tag like "100-10" as "major version 100, minor version negative 10" and
    # fails to update.  Work around this by changing these tags from "r100-10-abcdef-dirty" to
    # "r100.10.abcdef.dirty".
    #
    # You should never parse version numbers as if the entire world uses the same versioning scheme
    # that you do.  It should only check if the version is different and update if it changes, without
    # trying to figure out if it's newer or older.  If the version is older you should update to it
    # anyway, since if a script author rolled back a script update, it was probably for a reason.
    #
    # This only affects development versions.  Release versions are just "r123", which it doesn't have
    # problems with.
    _git_tag = _git_tag.replace("-", ".")

    return _git_tag


def to_javascript_string(s):
    """
    Return s as a JavaScript string.
    """
    escaped = re.sub(r"""([`$\\])""", r"\\\1", s)

    # This is a hopefully temporary workaround for "Stay" to stop it from stripping our
    # comments by replacing "//" in source code strings with "/\\x2f":
    #
    # https://github.com/shenruisi/Stay/issues/60
    escaped = escaped.replace("//", "/\\x2f")
    return "`%s`" % escaped


class Build(object):
    # Source maps will point to here:
    github_root = "https://raw.githubusercontent.com/ppixiv/ppixiv/"

    # Info for deployment.  If you're just building locally, these won't be used.
    deploy_s3_bucket = "ppixiv"
    distribution_root = f"https://ppixiv.org"

    @classmethod
    def build(cls):
        parser = argparse.ArgumentParser()
        parser.add_argument(
            "--deploy",
            "-d",
            action="store_true",
            default=False,
            help="Deploy a release version",
        )
        parser.add_argument(
            "--latest",
            "-l",
            action="store_true",
            default=False,
            help="Point latest at this version",
        )
        parser.add_argument(
            "--port",
            "-p",
            action="store",
            default=None,
            help="Location of the debug server port for ppixiv-debug",
        )
        args = parser.parse_args()

        # This is a release if it has a tag and the working copy is clean.
        result = subprocess.run(
            ["git", "describe", "--tags", "--match=r*", "--exact-match"],
            capture_output=True,
        )
        is_tagged = result.returncode == 0

        result = subprocess.run(
            ["git", "status", "--porcelain", "--untracked-files=no"],
            capture_output=True,
        )
        is_clean = len(result.stdout) == 0

        is_release = is_tagged and is_clean

        if len(sys.argv) > 1 and sys.argv[1] == "--release":
            is_release = True

        if is_release:
            git_tag = get_git_tag()
        else:
            git_tag = None

        if is_release:
            print("Release build: %s" % git_tag)
        else:
            reason = []
            if not is_clean:
                reason.append("working copy dirty")
            if not is_tagged:
                reason.append("no tag")
            print("Development build: %s" % ", ".join(reason))

        try:
            os.makedirs("output")
        except OSError as e:
            # Why is os.makedirs "create all directories, but explode if the last one already
            # exists"?
            if e.errno != errno.EEXIST:
                raise

        # Before building, download dart-sass and esbuild if needed.  This lets the ppixiv
        # build work if vview isn't being used.
        Build._download_sass()
        Build._download_esbuild()

        build = cls(is_release=is_release, git_tag=git_tag)
        build.build_with_settings(
            deploy=args.deploy, latest=args.latest, debug_server_port=args.port
        )

    @classmethod
    def _download_sass(cls):
        """
        Download a dart-sass prebuilt into bin/dart-sass.
        """
        output_dir = _root_path() / "bin" / "dart-sass"
        util.download_sass(output_dir)

    @classmethod
    def _download_esbuild(cls):
        """
        Download an esbuild prebuilt into bin/esbuild.
        """
        output_dir = _root_path() / "bin" / "esbuild"
        util.download_esbuild(output_dir)

    def __init__(self, *, is_release=False, git_tag="devel"):
        self.is_release = is_release
        self.git_tag = git_tag
        self.distribution_url = f"{self.distribution_root}/builds/{get_git_tag()}"

    def build_with_settings(
        self, *, deploy=False, latest=False, debug_server_port=None
    ):
        self.build_release()
        self.build_debug(debug_server_port)
        if deploy:
            self.deploy(latest=latest)

    def deploy(self, latest=False):
        """
        Deploy the distribution to the website.

        The build contains these files for each release:

        /builds/r1234/ppixiv-main.user.js is main application.
        /builds/r1234/ppixiv.user.js is the regular userscript stub, which loads ppixiv-main.user.js with
        a @require.
        /builds/r1234/ppixiv-launch.user.js is an alternate userscript stub, which uses launch.js to load
        ppixiv-main.user.js.  This used on mobile to work around poor update handling on mobile script
        managers.

        /latest contains a copy of the latest build (except for ppixiv-main).
        /beta contains the build files for a test release.
        /install redirects to /latest/ppixiv.user.js, so the script can be installed from https://ppixiv.org/install.
        /test redirects to /beta/ppixiv.user.js, so the test version can be installed from https://ppixiv.org/test.
        """

        def create_file(text, output_filename):
            url = f"s3://{self.deploy_s3_bucket}/{output_filename}"
            print(f"Uploading: {url}")
            subprocess.run(
                [
                    "aws",
                    "s3",
                    "cp",
                    "--acl",
                    "public-read",
                    "-",
                    url,
                ],
                input=text.encode("utf-8"),
                check=True,
            )

        def copy_file(source, path, output_filename=None):
            if output_filename is None:
                output_filename = os.path.basename(source)

            url = f"s3://{self.deploy_s3_bucket}/{path}/{output_filename}"
            print(f"Uploading: {url}")
            subprocess.run(
                [
                    "aws",
                    "s3",
                    "cp",
                    "--quiet",
                    "--acl",
                    "public-read",
                    source,
                    url,
                ],
                check=True,
            )

        if not self.is_release:
            # If we're deploying a dirty build, just copy the full build to https://ppixiv.org/beta
            # for quick testing.  Don't clutter the build directory with "r123-dirty" builds.
            print("Deploying beta only")
            copy_file("output/ppixiv.user.js", "beta")
            copy_file("output/ppixiv-main.user.js", "beta")
            create_file(self.build_launch(devel=True), "beta/ppixiv-launch.user.js")
            return

        # Copy files for this version into https://ppixiv.org/builds/r1234.
        version = get_git_tag()
        for filename in ("ppixiv.user.js", "ppixiv-main.user.js"):
            copy_file(f"output/{filename}", f"builds/{version}")
        create_file(
            self.build_launch(devel=False), f"builds/{version}/ppixiv-launch.user.js"
        )

        # Update the beta to point to this build.
        copy_file("output/ppixiv.user.js", "beta")

        if latest:
            # Copy the loader to https://ppixiv.org/latest/ppixiv.user.js:
            copy_file("output/ppixiv.user.js", "latest")

            # This file doesn't change much, but make sure there's a copy in latest too.
            create_file(self.build_launch(devel=False), f"latest/ppixiv-launch.user.js")

    def build_release(self):
        """
        Build the final output/ppixiv.user.js script.
        """
        # Generate the main script.  This can be installed directly, or loaded by the
        # loader script.
        output_file = "output/pppixiv.user.js"
        print("Building: %s" % output_file)

        data = self.build_output()
        data = data.encode("utf-8")
        sha256 = hashlib.sha256(data).hexdigest()

        with open(output_file, "w+b") as output_file:
            output_file.write(data)

        # Generate the loader script.  This is intended for use on GreasyFork so we can update
        # the script without pushing a 1.5MB update each time, and so we won't eventually run
        # into the 2MB size limit.
        output_loader_file = "output/ppixiv.user.js"
        print("Building: %s" % output_loader_file)
        result = self.build_header(version_name=self.get_release_version())

        # Add the URL where the above script will be available.  If this is a release, it'll be
        # in the regular distribution directory with the release in the URL.  If this is a debug
        # build, we only keep the latest version around in /beta.
        if self.is_release:
            main_url = f"{self.distribution_url}/ppixiv-main.user.js"
        else:
            main_url = f"{self.distribution_root}/beta/ppixiv-main.user.js"

        result.append(f"// @require     {main_url}#sha256={sha256}")
        result.append(f"// ==/UserScript==" + "\n")

        # Add a dummy statement.  Greasy Fork complains about "contains no executable code" if there's
        # nothing in the top-level script, since it doesn't understand that all of our code is in a
        # @require.
        result.append("(() => {})();")

        data = "\n".join(result) + "\n"
        data = data.encode("utf-8")
        with open(output_loader_file, "w+b") as output_file:
            output_file.write(data)

    def build_debug(self, debug_server_port=None):
        import time

        if debug_server_port is None:
            debug_server_port = "8000"

        output_file = "output/pppixiv-debug.user.js"
        print("Building: %s" % output_file)

        debug_url = f"http://127.0.0.1:{debug_server_port}/output/pppixiv.user.js"
        timestamp = int(time.time())
        # Add the loading code for debug builds, which just runs bootstrap_native.js.
        debug_script = f"""
// ==UserScript==
// @name pppixiv for Pixiv
// @author rainbowflesh, ppixiv
// @namespace pppixiv
// @description A PPixiv overhaul.
// @homepage https://github.com/ppixiv/ppixiv
// @match https://*.pixiv.net/*
// @run-at document-start
// @icon https://ppixiv.org/ppixiv.png
// @grant GM.xmlHttpRequest
// @grant GM.setValue
// @grant GM.getValue
// @connect pixiv.net
// @connect pximg.net
// @connect self
// @connect *
// @comment Live debug profile
// @require {debug_url}
// @version {timestamp}
// ==/UserScript==

(async function () {{
    GM.xmlHttpRequest({{
        url: "{debug_url}",
        onload: async (response) => {{
            const text = response.responseText;
            const storageData = await GM.getValue("CachedScriptKey");

            if (text != storageData) {{
                console.log("PPPixiv Debug: update script");

                await GM.setValue("CachedScriptKey", text);
                location.reload();
            }} else {{
                console.log("PPPixiv Debug: nothing changed, skipping");
            }}
        }},
    }});
}})();
"""
        with open(output_file, "w", encoding="utf-8") as f:
            f.write(debug_script)

    def build_launch(self, *, devel):
        """
        Build the ppixiv-launch version of the userscript.

        This uses an alternative launcher that loads the current version directly from
        our server, as a workaround for userscript managers with broken updating.  This
        has a flag for whether to load the release or beta version, so this is generated
        dynamically.
        """
        result = self.build_header(
            version_name="Loader",
            version_suffix="(testing, loader)" if devel else "testing",
        )
        result.append(f"// ==/UserScript==" + "\n")

        result.append(
            """
(async() => {
    // If this is an iframe, don't do anything.
    if(window.top != window.self)
        return;

    let { launch } = await import("https://ppixiv.org/launch.js");
    eval(await launch({ devel: %(for_debug)s }));
})();
        """
            % {"for_debug": "true" if devel else "false"}
        )

        return "\n".join(result) + "\n"

    def get_resource_list(self):
        results = collections.OrderedDict()
        resource_path = Path("web/resources")
        files = list(resource_path.glob("**/*"))
        files.sort()
        for path in files:
            path = Path(path)
            name = path.relative_to(resource_path)
            results["resources/" + name.as_posix()] = path

        return results

    def _make_temp_path(self):
        """
        Create a reasonably unique filename for a temporary file.

        tempfile insists on creating the file and doesn't give us a way to simply generate
        a filename, which is what's needed when we're passing a filename to a subprocess.
        """
        fn = "".join(random.choice(string.ascii_lowercase) for _ in range(10))
        return Path(tempfile.gettempdir()) / ("vview-" + fn)

    def get_build_timestamp(self):
        """
        Return the newest timestamp of any file in the web part of the source tree.

        This is treated as the timestamp for the output bundle and used for HTTP caching.
        """
        root = _root_path() / "web"
        newest_mtime = 0
        for path in root.rglob("*"):
            try:
                if not path.is_file():
                    continue
            except OSError:
                # Windows links cause is_file() to throw an error for some reason.
                continue

            mtime = path.stat().st_mtime
            newest_mtime = max(mtime, newest_mtime)
        return int(newest_mtime)

    def build_css(self, path):
        # Return the file:/// path containing local source.
        #
        # This is only used for development builds.
        local_root_url = (_root_path() / "web").as_uri()

        # Return the URL to the top of the source tree, which source maps point to.
        #
        # This is used in used in sourceURL, and the URLs source maps point to.  In development,
        # this is a file: URL pointing to the local source tree.  For releases, this points to
        # the tag on GitHub for this release.
        if self.is_release:
            embed_source_root = self.github_root + self.git_tag
        else:
            embed_source_root = local_root_url

        path = path.resolve()

        # The path to dart-sass:
        dart_path = _root_path() / "bin" / "dart-sass"
        dart_exe = dart_path / "dart"
        sass = dart_path / "sass.snapshot"

        output_css = self._make_temp_path().with_suffix(".css")
        output_map = output_css.with_suffix(".css.map")

        # Run dart-sass.  We have to output to temporary files instead of reading stdout,
        # since it doesn't give any way to output the CSS and source map separately that way.
        dart_args = [
            dart_exe,
            sass,
        ]

        try:
            result = subprocess.run(
                dart_args
                + [
                    "--no-embed-source-map",
                    str(path),
                    str(output_css),
                ],
                capture_output=True,
            )
        except FileNotFoundError as e:
            # If dart-sass doesn't exist in bin/dart-sass, it probably hasn't been downloaded.  Run
            # vview.build.build_vview first at least once to download it.
            raise Exception(f"dart-sass not found in {dart_path}") from None

        if result.returncode:
            # Errors from dart are printed to stderr, but errors from SASS itself go to
            # stdout.
            output = result.stderr.decode("utf-8").strip()
            if not output:
                output = result.stdout.decode("utf-8").strip()

            raise BuildError(f"Error building {path}: {output}")

        # Read the temporary files, then clean them up.
        with open(output_css, "rt", encoding="utf-8") as f:
            data = f.read()

        with open(output_map, "rt", encoding="utf-8") as f:
            source_map = f.read()

        output_css.unlink()
        output_map.unlink()

        # dart-sass doesn't let us tell it the source root.  They expect us to decode it and
        # fix it ourself.  It's pretty obnoxious to have to jump a bunch of hoops because they
        # couldn't be bothered to just let us pass in a URL and tell it where the top path is.
        #
        # We expect all CSS files to be inside the web/resources directory, eg:
        #
        # file:///c:/files/ppixiv/web/resources/main.scss
        #
        # Map these so they're relative to the root, and set sourceRoot to embed_source_root.
        source_map = json.loads(source_map)
        expected_wrong_url = local_root_url
        if not expected_wrong_url.endswith("/"):
            expected_wrong_url += "/"

        def fix_url(url):
            # Resolve the path relative to the CSS file.
            url = str(urllib.parse.urljoin(output_css.as_uri(), url))

            # The path inside the map is relative to the CSS file, so is relative to
            if not url.startswith(expected_wrong_url):
                raise Exception(
                    f"Expected CSS source map URL {url} to be inside {expected_wrong_url}"
                )
            return url[len(expected_wrong_url) :]

        source_map["sources"] = [fix_url(url) for url in source_map["sources"]]
        source_map["sourceRoot"] = embed_source_root

        # Fix the filename, so it doesn't contain the temporary filename.
        source_map["file"] = Path(path).relative_to(_root_path()).as_posix()

        # Reserialize the source map.
        source_map = json.dumps(source_map, indent=0)

        # Compounding the above problem: if you tell it not to embed the source map, it appends
        # the sourceMappingURL, and there's no way to tell it not to, so we have to find it and
        # strip it off.
        lines = data.split("\n")
        assert lines[-2].startswith("/*# sourceMappingURL")
        assert lines[-1] == ""
        lines[-2:-1] = []
        data = "\n".join(lines)

        # Embed our fixed source map.
        encoded_source_map = base64.b64encode(source_map.encode("utf-8")).decode(
            "ascii"
        )
        data += (
            "/*# sourceMappingURL=data:application/json;base64,%s */"
            % encoded_source_map
        )

        return data

    def build_header(self, *, version_name, version_suffix=None):
        result = []
        with open("web/vview/startup/header.js", "rt", encoding="utf-8") as input_file:
            for line in input_file.readlines():
                line = line.strip()

                # Change the name of the testing script so it can be distinguished in the script dropdown.
                if line.startswith("// @name ") and version_suffix:
                    line += f" {version_suffix}"

                result.append(line)

        # Add @version.
        result.append("// @version     %s" % version_name)

        return result

    def get_release_version(self):
        import subprocess
        from datetime import datetime

        try:
            # Get current date in YYYYMMDD format
            today = datetime.now().strftime("%Y%m%d")

            # Get short git commit hash (7 characters)
            result = subprocess.run(
                ["git", "rev-parse", "--short", "HEAD"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
                text=True,
            )
            git_hash = result.stdout.strip()

            return f"{today}-{git_hash}"
        except subprocess.CalledProcessError as e:
            print(f"Warning: failed to get git commit hash: {e}")
            return "unknown"

    def build_all_css(self):
        """
        Compile all SCSS files in web/resources/css to output/css.

        Imports from web/resources/css are redirected to output/css by tsconfig.json.
        """
        root = _root_path()

        css_input_path = root / "web/resources/css"
        css_output_path = root / "output/intermediate/css"
        for path in css_input_path.rglob("*.scss"):
            css_text = self.build_css(path)
            css_output_path.mkdir(parents=True, exist_ok=True)
            css_output_file = css_output_path / path.name
            with css_output_file.open("wt", encoding="utf-8") as f:
                f.write(css_text)

    def build_resource_imports(self):
        """
        For esbuild to include resources, they need to be statically imported somewhere
        in the code, but our resources are loaded dynamically.  Generate a script that
        imports all files in web/resources and exports them as a dictionary.
        """
        # Find all resources.
        root = _root_path()
        resources_path = root / "web/resources"
        resource_paths = {}
        for path in resources_path.rglob("*"):
            if not path.is_file():
                continue

            # Generate a name for this.  The particular name doesn't matter, since it
            # only appears in app-resources.js.
            relative_path = path.relative_to(resources_path)
            name = relative_path.as_posix()
            resource_id = name.replace(".", "_").replace("-", "_").replace("/", "_")
            resource_paths[resource_id] = "/resources/" + relative_path.as_posix()

        # Import each resource:
        script = []
        for resource_id, path in resource_paths.items():
            script.append(f"import {resource_id} from '{path}';")

        script.append("")

        # Return a dictionary of resources:
        script.append("export function getResources()")
        script.append("{")
        script.append("    return {")

        for resource_id, path in resource_paths.items():
            # The internal resource paths don't begin with a slash.
            path = path.lstrip("/")
            script.append(f"        {json.dumps(path)}: {resource_id},")

        script.append("    };")
        script.append("};")

        script = "\n".join(script)

        output_path = root / "output/intermediate/app-resources.js"
        with output_path.open("wt", encoding="utf-8") as f:
            f.write(script)

        return "\n".join(script)

    def build_bundle(self, *, get_sourcemap=False):
        """
        Build the app bundle and source map.

        If get_sourcemap is true, return the contents of the source map, otherwise the
        bundle.  If both are needed we'll build twice, but esbuild is fast enough that
        it's not worth optimizing around this.
        """
        # Make sure generated CSS files are up to date.  esbuild will pull these in
        # via the tsconfig.json redirect.
        self.build_all_css()

        self.build_resource_imports()

        esbuild_path = _root_path() / "bin" / "esbuild/esbuild"
        output_file_js = self._make_temp_path()
        output_file_map = output_file_js.with_suffix(".map")
        try:
            result = subprocess.run(
                [
                    esbuild_path,
                    "web/vview/app-startup.js",
                    "--bundle",
                    f"--outfile={output_file_js}",
                    "--sourcemap",
                    "--source-root=web",
                    f"--define:VVIEW_VERSION={json.dumps(get_git_tag())}",
                    "--sourcemap=external",
                    "--log-level=error",
                    "--charset=utf8",
                    "--loader:.png=binary",
                    "--loader:.woff=binary",
                    "--loader:.html=text",
                    "--loader:.svg=text",
                    "--loader:.scss=text",
                ]
            )

        except FileNotFoundError as e:
            # If dart-sass doesn't exist in bin/dart-sass, it probably hasn't been downloaded.  Run
            # vview.build.build_vview first at least once to download it.
            raise Exception(f"esbuild not found in {esbuild_path}") from None

        if result.returncode != 0:
            raise BuildError(f"Error building app bundle")

        result_file = output_file_map if get_sourcemap else output_file_js
        script = result_file.open("rt").read()
        return script

    def build_output(self):
        result = self.build_header(version_name=self.get_release_version())
        result.append(f"// ==/UserScript==" + "\n")

        # Encapsulate the script.
        result.append("(function() {\n")

        result.append(
            f"// The script is packaged into a string so we can execute it outside of the"
        )
        result.append(
            f"// userscript sandbox to avoid various problems with script managers."
        )

        # Add the main bundle.
        bundle = self.build_bundle()
        bundle = to_javascript_string(bundle)
        result.append(f"let bundle = {bundle};")

        # Add the bootstrap code directly.
        bootstrap = open(
            "web/vview/startup/bootstrap.js", "rt", encoding="utf-8"
        ).read()
        result.append(bootstrap)
        result.append("Bootstrap({bundle});\n")

        result.append("})();\n")

        return "\n".join(result) + "\n"


if __name__ == "__main__":
    Build().build()
