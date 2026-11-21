import { describe, expect, it } from "vitest";
import { detectShellFileEdit } from "../src/core/tools/bash-edit.ts";

describe("detectShellFileEdit", () => {
	it.each([
		["sed -i s/a/b/ src/app.ts", "sed", "src/app.ts"],
		["sed -i 's/foo/bar/' src/app.ts", "sed", "src/app.ts"],
		['sed -ni "s/a b/c d/" f.ts', "sed", "f.ts"],
		["sed -i 's/$X/$Y/' f.ts", "sed", "f.ts"],
		["sed --in-place -e 's/a/b/' f.ts", "sed", "f.ts"],
		["perl -pi -e 's/a/b/' f.pl", "perl", "f.pl"],
		["cat > out.txt <<EOF\nhello\nEOF", "cat", "out.txt"],
		["cat >> out.txt <<'EOF'\nhello\nEOF", "cat", "out.txt"],
		["tee out.txt <<EOF\nhello\nEOF", "tee", "out.txt"],
		["tee -a out.txt <<EOF\nhello\nEOF", "tee", "out.txt"],
		["echo hi > t.txt", "echo", "t.txt"],
		["echo hi >t.txt", "echo", "t.txt"],
		["echo hi >> t.txt", "echo", "t.txt"],
		["echo 'a > b' > t.txt", "echo", "t.txt"],
		["printf '%s\\n' x > t.txt", "printf", "t.txt"],
		["echo $HOME > t.txt", "echo", "t.txt"],
	])("reads %s as an edit of %s", (command, tool, path) => {
		expect(detectShellFileEdit(command)).toEqual({ tool, path });
	});

	it.each([
		["sed 's/a/b/' f.ts"],
		["sed -i.bak s/a/b/ f.ts"],
		["sed -i s/a/b/ a.ts b.ts"],
		["sed -i s/a/b/ *.ts"],
		["sed -i s/a/b/ $FILE"],
		["perl -pi fix.pl"],
		["echo hi"],
		["cat f.ts"],
		["tee out.txt"],
		["echo hi > a.txt > b.txt"],
		["echo hi | tee out.txt"],
		["ls -1 | grep x"],
		["sed -i s/a/b/ f.ts && cargo build"],
		["echo $(rm -rf /) > t.txt"],
		["echo `id` > t.txt"],
		["sed -i 's/a/b/ f.ts"],
		["rm -f t.txt"],
		["git commit -m 'edit'"],
		["echo changed > main.txt\nrm other.txt"],
		["cat > main.txt <<EOF\nhello\nEOF\nrm other.txt"],
	])("leaves %s a plain shell row", (command) => {
		expect(detectShellFileEdit(command)).toBeUndefined();
	});
});
