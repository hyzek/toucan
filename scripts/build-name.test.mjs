import assert from "node:assert/strict";
import test from "node:test";
import { buildNameFromVersion, buildNumberFromVersion, versionFromBuildNumber } from "./build-name.mjs";

test("maps a build version to its name and back", () => {
	assert.equal(buildNumberFromVersion("23.0.0"), 23);
	assert.equal(buildNameFromVersion("23.0.0"), "b23");
	assert.equal(versionFromBuildNumber(23), "23.0.0");
});

test("only N.0.0 carries a build number, so releases start from a build version", () => {
	assert.equal(buildNumberFromVersion("1.5.0"), undefined);
	assert.equal(buildNumberFromVersion(""), undefined);
});
