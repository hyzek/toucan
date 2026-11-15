import assert from "node:assert/strict";
import test from "node:test";
import { buildNameFromVersion, buildNumberFromVersion, versionFromBuildNumber } from "./build-name.mjs";

test("maps a build version to its name and back", () => {
	assert.equal(buildNumberFromVersion("1.23.0"), 23);
	assert.equal(buildNameFromVersion("1.23.0"), "b23");
	assert.equal(versionFromBuildNumber(23), "1.23.0");
});

test("reads build versions of the legacy N.0.0 scheme", () => {
	assert.equal(buildNumberFromVersion("23.0.0"), 23);
	assert.equal(buildNameFromVersion("23.0.0"), "b23");
	// "1.0.0" is legacy build 1; a build number of 0 would not name a release.
	assert.equal(buildNumberFromVersion("1.0.0"), 1);
});

test("only build versions carry a build number, so releases start from one", () => {
	assert.equal(buildNumberFromVersion("1.5.1"), undefined);
	assert.equal(buildNumberFromVersion("0.0.3"), undefined);
	assert.equal(buildNumberFromVersion(""), undefined);
});
