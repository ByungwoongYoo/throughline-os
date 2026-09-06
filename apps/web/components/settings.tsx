"use client";

/**
 * Settings — which model does the thinking.
 *
 * The whole point of a local-first deployment is that this is the researcher's
 * choice, not ours. A PhD student on a laptop and a lab with a workstation run
 * the same software against very different hardware, and the honest thing is to
 * show what this machine actually has rather than assume.
 *
 * Three things are stated rather than implied.
 *
 * **What the model is and is not used for.** It reads papers and writes prose.
 * It never *authors* a number or a verdict: statistics come from the sandbox,
 * comparability from `compare.py`'s deterministic checks, and every extracted
 * sentence is verified verbatim against the paper before it is stored, so an
 * altered quote becomes no answer rather than a wrong one.
 *
 * But "identical whichever you choose" was too strong, and this screen used to
 * say it. What a smaller model changes is *coverage*: which sentences it
 * manages to locate at all. A field it fails to find is simply absent — no
 * error, no gap marker — and a real 7B model once returned nothing from a
 * paper that stated seven of the nine fields. The trade is recall, not rigour,
 * and a reader deciding between models needs the distinction stated rather
 * than reassured away.
 *
 * **Whether inference is local.** That is a privacy fact, not a performance
 * one: it decides whether unpublished research leaves the machine (§98).
 *
 * **Every past change.** Swapping the model changes what the system writes, so
 * a reader who finds two differently-worded summaries of one run is entitled to
 * discover why (LAW 4).
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Failure, Loading } from "./primitives";
import { ConfirmDialog } from "./ConfirmDialog";

type Installed = {
  name: string;
  size_bytes: number | null;
  parameters: string | null;
  quantization: string | null;
  family: string | null;
  /*
   * Whether this model runs on this machine.
   *
   * Ollama serves cloud models — a `:cloud` tag runs on ollama.com — and lists
   * them from `/api/tags` beside the local ones. The picker showed them
   * identically, so choosing one looked like choosing a local model while every
   * passage of a researcher's papers left the machine.
   */
  runs_here?: boolean;
};

type Change = {
  old_value: { provider?: string; model?: string } | null;
  new_value: { provider?: string; model?: string };
  changed_by: string;
  changed_at: string;
};

type Hosted = {
  provider: string;
  model: string;
  key_saved: boolean;
  /** The last four characters. Never the key. */
  key_hint: string | null;
  local: boolean;
  billed: string;
  warning: string;
};

type Models = {
  hosted?: Hosted;
  installed: Installed[];
  selection: { provider: string; model: string | null; source: string };
  active: {
    name: string; model: string; usable: boolean; local: boolean;
    structured: boolean; note: string | null;
  };
  history: Change[];
  note: string | null;
  how_to_install: string;
};

function gigabytes(bytes: number | null): string {
  if (!bytes) return "";
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

type Projection = {
  configured: boolean;
  reachable: boolean;
  queries: string[];
  nodes?: number;
  edges?: number;
  built_at?: string | null;
  note: string;
};

/**
 * Adding a colleague, and changing your own password.
 *
 * There is no self-service registration and there should not be: this is a
 * local-first workspace, not a service. Anyone who can reach the port is on the
 * machine or the network the researcher chose, and an open sign-up endpoint
 * would let them help themselves to the corpus.
 */
export function Accounts() {
  const [people, setPeople] = useState<Array<{
    id: string; email: string; display_name: string; is_admin: boolean;
  }> | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const [peopleError, setPeopleError] = useState<unknown>(null);

  function load() {
    /*
     * `null` and "nobody" render the same: the list below maps over
     * `people?.` and an unread list draws no rows, directly under the
     * sentence "Everyone with an account on this installation." A reader who
     * is themselves signed in is then shown a list that says they do not
     * exist. Remembered and stated instead.
     */
    api.get<typeof people>("/api/auth/accounts")
      .then((rows) => { setPeople(rows); setPeopleError(null); })
      .catch((failure) => { setPeople(null); setPeopleError(failure); });
  }
  useEffect(load, []);

  async function addPerson() {
    setError(null); setMessage(null);
    try {
      await api.post("/api/auth/accounts",
                     { email, display_name: name, password });
      setEmail(""); setName(""); setPassword("");
      setMessage("Account created.");
      load();
    } catch (err) { setError(err); }
  }

  async function changePassword() {
    setError(null); setMessage(null);
    try {
      const result = await api.post<{ note: string }>(
        "/api/auth/password",
        { current_password: current, new_password: next });
      setCurrent(""); setNext("");
      setMessage(result.note);
    } catch (err) { setError(err); }
  }

  return (
    <>
      <section className="set-section">
        <h2>Your password</h2>
        <p className="set-sub">
          At least 12 characters — this protects a whole research corpus and you
          type it once. Changing it signs you out everywhere else.
        </p>
        <div className="set-form">
          <label>
            <span>Current password</span>
            <input type="password" value={current} autoComplete="current-password"
                   onChange={(e) => setCurrent(e.target.value)} />
          </label>
          <label>
            <span>New password</span>
            <input type="password" value={next} autoComplete="new-password"
                   onChange={(e) => setNext(e.target.value)} />
          </label>
          <button className="nj-primary"
                  disabled={!current || next.length < 12}
                  onClick={() => void changePassword()}>
            Change password
          </button>
        </div>
      </section>

      <section className="set-section">
        <h2>People</h2>
        <p className="set-sub">
          Everyone with an account on this installation. There is no public
          sign-up: accounts are added from inside, by someone already signed in.
        </p>

        {peopleError != null && (
          <Failure error={peopleError} retry={load} />
        )}

        <ul className="set-people">
          {people?.map((person) => (
            <li key={person.id}>
              <b>{person.display_name}</b>
              <span>{person.email}</span>
              {person.is_admin && <em>set up this installation</em>}
            </li>
          ))}
        </ul>

        <div className="set-form">
          <label>
            <span>Email</span>
            <input value={email} type="email" autoComplete="off"
                   onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            <span>Name</span>
            <input value={name} autoComplete="off"
                   onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            <span>Password (12+)</span>
            <input value={password} type="password" autoComplete="new-password"
                   onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button className="ct-dataset"
                  disabled={!email || password.length < 12}
                  onClick={() => void addPerson()}>
            Add person
          </button>
        </div>

        {message && <p className="set-note">{message}</p>}
        {error ? <Failure error={error} /> : null}
      </section>
    </>
  );
}

type Pack = {
  installed: boolean;
  distribution: string;
  enables: string;
  withheld_without_it: string;
  approximate_size: string;
  install: string | null;
  install_state?: "running" | "installed" | "failed" | null;
  install_detail?: string | null;
};

/**
 * The capabilities this installation does not have, and how to turn them on.
 *
 * The base install carries what every researcher needs. Everything else is an
 * extra, and until now four of them — the graph driver, local transcription,
 * figure digitising and the hosted model client — were undiscoverable except by
 * trying them and reading an error.
 *
 * Two things this screen refuses to do.
 *
 * **It does not say only what you would gain.** Every pack states what is
 * *withheld* without it, because "semantic search unavailable" is a fact about
 * the software and "search finds the word and not the meaning" is a fact about
 * your results — and only the second tells you whether the download is worth
 * it. Several of these are genuinely optional for most people, and a screen
 * that reads like an upsell earns less trust than one that says "you probably
 * do not need this".
 *
 * **It does not hide the size.** `speech` pulls in torch, which is gigabytes —
 * an order of magnitude more than everything else here combined. A researcher
 * on a metered connection is entitled to know that before the progress bar
 * starts rather than after.
 *
 * The command is shown next to the button on purpose. The button is the
 * convenience; the command is what somebody can run, read, paste into an issue,
 * or use when the button fails on a machine we cannot see.
 */
/** What `/api/system/capabilities` reports about Blender. */
type BlenderAvailability = {
  available: boolean;
  path: string | null;
  version: string | null;
  withheld?: string;
  install?: string;
};

/**
 * Whether this machine can render a figure through Blender.
 *
 * The API has always reported this — `availability()` composes a "withheld"
 * sentence and an install hint precisely so a researcher can be told — and
 * nothing displayed it. The capability was computed on every request and shown
 * to nobody, which is this project's most common defect wearing a different
 * hat.
 *
 * **Not a feature pack, and shown apart from them.** The packs above are Python
 * distributions this application installs for you on a button press. Blender is
 * a separate desktop program of several hundred megabytes; it cannot be
 * installed from here, it cannot run inside the browser — there is no
 * production build of Blender for the web — and pretending otherwise with a
 * button that fails would be worse than saying so.
 *
 * **Nothing here needs it.** Every chart in this application draws in the
 * browser, and the 3D figures export as geometry any tool can open. Blender
 * adds a physically-based render for publication, and that is all it adds — so
 * this row leads with what still works rather than with what is missing.
 */
function BlenderRow({ state }: { state: BlenderAvailability }) {
  return (
    <div className="set-blender" data-installed={state.available}>
      <div className="set-pack-head">
        <strong>Blender rendering</strong>
        <span className="set-pack-state">
          {state.available ? `found — ${state.version ?? "version unknown"}`
                           : "not on this machine"}
        </span>
      </div>
      <p>
        Optional, and separate from the packs above: Blender is its own
        application, not something this one can install. Every chart here draws
        in the browser without it, and a 3D figure exports as geometry that
        Blender or any other tool can open — this only adds a
        physically-based render for publication.
      </p>
      {!state.available && state.withheld !== undefined && (
        <p className="set-note">Without it: {state.withheld}</p>
      )}
      {!state.available && state.install !== undefined && (
        <p className="set-note">{state.install}</p>
      )}
      {state.available && state.path !== null && (
        <p className="set-note">
          Found at <code>{state.path}</code>. A Blender render varies with the
          version and the machine, so it is marked as a render rather than as
          the export, which is reproducible byte for byte.
        </p>
      )}
    </div>
  );
}

export function FeaturePacks() {
  const [packs, setPacks] = useState<Record<string, Pack> | null>(null);
  /*
   * `null` *or* absent. The capabilities endpoint is versioned by nothing, and
   * a response without this field is a perfectly ordinary older backend — so
   * the type says so and the render checks for both. Typing it as non-optional
   * and checking `!== null` crashed the whole settings screen on exactly that
   * response, because `undefined !== null`.
   */
  const [blender, setBlender] =
    useState<BlenderAvailability | null | undefined>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api.get<{ packs: Record<string, Pack>; blender: BlenderAvailability }>(
      "/api/system/capabilities")
      .then((c) => { setPacks(c.packs); setBlender(c.blender); })
      .catch(setError);
  }, []);

  /**
   * Start an install, then watch it.
   *
   * Polled rather than awaited: pip installing torch takes minutes, and a
   * request held open that long is a timeout reported to the researcher as a
   * failure while the install is still running perfectly well.
   */
  async function install(name: string) {
    setBusy(name);
    setError(null);
    try {
      await api.post(`/api/system/packs/${name}/install`);
      const poll = window.setInterval(async () => {
        try {
          const state = await api.get<Pack>(`/api/system/packs/${name}`);
          setPacks((current) =>
            current ? { ...current, [name]: { ...current[name], ...state } } : current);
          if (state.install_state !== "running") {
            window.clearInterval(poll);
            setBusy(null);
          }
        } catch (err) {
          window.clearInterval(poll);
          setError(err);
          setBusy(null);
        }
      }, 3000);
    } catch (err) {
      setError(err);
      setBusy(null);
    }
  }

  if (!packs) return null;

  const entries = Object.entries(packs);
  const absent = entries.filter(([, pack]) => !pack.installed);

  return (
    <section className="set-section">
      <h2>Feature packs</h2>
      <p className="set-sub">
        {absent.length === 0
          ? "Every optional capability is installed on this machine."
          : `${absent.length} of ${entries.length} optional capabilities are not `
            + "installed here. Each one is genuinely optional — nothing below is "
            + "needed to open your work, run an analysis, or read a paper."}
      </p>

      {blender != null && <BlenderRow state={blender} />}

      <ul className="set-packs">
        {entries.map(([name, pack]) => (
          <li key={name} data-installed={pack.installed}>
            <div className="set-pack-head">
              <strong>{name}</strong>
              <span className="set-pack-state">
                {pack.installed ? "installed" : pack.approximate_size}
              </span>
            </div>
            <p>{pack.enables}</p>
            {!pack.installed && (
              <p className="set-note">Without it: {pack.withheld_without_it}</p>
            )}

            {!pack.installed && (
              <div className="set-pack-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => install(name)}
                  disabled={busy !== null || pack.install_state === "running"}
                >
                  {pack.install_state === "running" || busy === name
                    ? "Installing…"
                    : "Install"}
                </button>
                {/* Shown beside the button, not instead of it: the command is
                    what somebody can read, paste into an issue, or fall back to
                    when the button fails on a machine nobody can see. */}
                {pack.install && <code>{pack.install}</code>}
              </div>
            )}

            {pack.install_state === "running" && (
              <p className="set-note">
                This can take several minutes, and longer for anything that
                pulls in a machine-learning runtime. You can leave this page.
              </p>
            )}
            {pack.install_state === "failed" && (
              <p className="set-error" role="alert">
                {pack.install_detail || "The install did not finish."}
              </p>
            )}
          </li>
        ))}
      </ul>

      {error != null && (
        <p className="set-error" role="alert">
          {error instanceof Error ? error.message : "Could not read capabilities."}
        </p>
      )}
    </section>
  );
}

type Version = {
  version: string | null;
  source: "release" | "checkout" | "unknown";
  commit: string | null;
  modified: boolean;
  note: string;
};

type UpdateCheck = {
  checked: boolean;
  reason?: string;
  channel?: string;
  following?: string;
  behind?: number;
  ahead?: number;
  update_available?: boolean;
  how?: string | null;
};

/**
 * Which version this is, and whether there is a newer one.
 *
 * Two things this screen is careful about.
 *
 * **It never checks on its own.** T073's first line is "never automatic", and
 * an effect that checked on mount would quietly make it automatic — every visit
 * to Settings becoming a network request, and eventually a habit nobody
 * remembers agreeing to. The version itself is shown immediately because that
 * costs nothing; asking GitHub happens when somebody asks.
 *
 * **It distinguishes "up to date" from "I could not ask".** Those look
 * identical on a screen and only one of them means what it says. A researcher
 * on a train who is told they are up to date has been told something false.
 *
 * The command is shown rather than an Update button, and that is not timidity:
 * applying an update replaces the code the API process is running from, so it
 * cannot be done from inside that process. A button that appeared to do it
 * would have to lie about when it had finished.
 */
export function VersionPanel() {
  const [version, setVersion] = useState<Version | null>(null);
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api.get<Version>("/api/system/version").then(setVersion).catch(setError);
  }, []);

  async function checkNow() {
    setChecking(true);
    setError(null);
    setCheck(null);
    try {
      setCheck(await api.post<UpdateCheck>("/api/system/version/check"));
    } catch (err) {
      setError(err);
    } finally {
      setChecking(false);
    }
  }

  if (!version) return null;

  return (
    <section className="set-section">
      <h2>Version</h2>
      <p className="set-sub">
        Which version produced a result is part of that result. `main` on Tuesday
        and `main` on Thursday are different software wearing one name.
      </p>

      <dl className="set-facts">
        <div>
          <dt>Running</dt>
          <dd>{version.version ?? "unknown"}</dd>
        </div>
        <div>
          <dt>Established from</dt>
          <dd>
            {version.source === "release" ? "a stamped release"
              : version.source === "checkout" ? "the git checkout"
              : "nothing — this installation cannot say"}
          </dd>
        </div>
        {version.modified && (
          <div>
            <dt>Modified</dt>
            <dd>uncommitted changes are present</dd>
          </div>
        )}
      </dl>
      <p className="set-note">{version.note}</p>

      <div className="set-pack-actions">
        <button type="button" className="btn" onClick={checkNow} disabled={checking}>
          {checking ? "Checking…" : "Check for updates"}
        </button>
      </div>

      {check && !check.checked && (
        /* Not "up to date". Saying so would be inventing an answer. */
        <p className="set-note" role="status">
          Could not check: {check.reason}
        </p>
      )}

      {check?.checked && !check.update_available && (
        <p className="set-note" role="status">
          Up to date with {check.following} ({check.channel}).
          {check.ahead ? ` This checkout is ${check.ahead} commit(s) ahead of it.` : ""}
        </p>
      )}

      {check?.checked && check.update_available && (
        <>
          <p className="set-note" role="status">
            {check.behind} update(s) available on {check.channel}. Updating backs
            up your database first and puts the previous version back if anything
            fails.
          </p>
          <div className="set-pack-actions">
            <code>{check.how}</code>
          </div>
        </>
      )}

      {error != null && (
        <p className="set-error" role="alert">
          {error instanceof Error ? error.message : "Could not read the version."}
        </p>
      )}
    </section>
  );
}

type Launcher = {
  platform: string;
  supported: boolean;
  note?: string;
  file?: string;
  path?: string;
  present?: boolean;
  how?: string;
  warning?: string | null;
  needs_desktop_entry?: boolean;
  desktop_entry_installed?: boolean | null;
  command?: string;
};

/**
 * How to start Throughline without a terminal.
 *
 * `launchers/` has held one double-click door per platform since T071, and the
 * only place that said so was the README — which is exactly the wrong place,
 * because T071 exists for somebody who has never opened a terminal and that
 * person is not reading a markdown file in a repository. A capability nothing
 * links to is the same defect as a button that does nothing.
 *
 * **Only this machine's door is shown.** A macOS `.command` offered on Windows
 * is noise, and making the reader work out which of three applies is work the
 * software has already done.
 *
 * **The security warning comes before the click, not after.** These are
 * unsigned, so the first double-click raises Gatekeeper or SmartScreen. A
 * researcher who meets that unprepared concludes they have downloaded something
 * dangerous and stops — which is the right instinct, and the reason to spend a
 * sentence on it in advance.
 */
export function StartingPanel() {
  const [launcher, setLauncher] = useState<Launcher | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api.get<Launcher>("/api/system/launchers")
      .then(setLauncher)
      .catch(setError);
  }, []);

  async function addToMenu() {
    setAdding(true);
    setError(null);
    try {
      const result = await api.post<{ installed: boolean; note: string }>(
        "/api/system/launchers/desktop-entry");
      setAdded(result.note);
      if (result.installed) {
        setLauncher((c) => (c ? { ...c, desktop_entry_installed: true } : c));
      }
    } catch (err) {
      setError(err);
    } finally {
      setAdding(false);
    }
  }

  if (!launcher) return null;

  return (
    <section className="set-section">
      <h2>Starting Throughline</h2>

      {!launcher.supported && (
        <p className="set-sub">{launcher.note}</p>
      )}

      {launcher.supported && (
        <>
          <p className="set-sub">{launcher.how}</p>

          <dl className="set-facts">
            <div>
              <dt>Launcher</dt>
              <dd>
                {launcher.present
                  ? <code>{launcher.file}</code>
                  /* Said rather than hidden: pointing somebody at a file that
                     is not on their disk costs more trust than saying nothing. */
                  : `${launcher.file} — not in this installation`}
              </dd>
            </div>
            <div>
              <dt>Or from a terminal</dt>
              <dd><code>{launcher.command}</code></dd>
            </div>
          </dl>

          {launcher.warning && (
            <p className="set-note">{launcher.warning}</p>
          )}

          {launcher.needs_desktop_entry && launcher.present && (
            <>
              <p className="set-note">
                Most Linux desktops will not run a double-clicked script, so the
                thing that actually responds to a click is a menu entry.
                {launcher.desktop_entry_installed
                  ? " One is installed."
                  : " There is not one yet."}
              </p>
              <div className="set-pack-actions">
                <button type="button" onClick={addToMenu} disabled={adding}>
                  {adding ? "Adding…"
                    : launcher.desktop_entry_installed
                      ? "Add it again"
                      : "Add to applications menu"}
                </button>
              </div>
            </>
          )}

          {added && <p className="set-note" role="status">{added}</p>}
        </>
      )}

      {error != null && (
        <p className="set-error" role="alert">
          {error instanceof Error ? error.message : "Could not read the launchers."}
        </p>
      )}
    </section>
  );
}

export function Settings() {
  const [models, setModels] = useState<Models | null>(null);
  const [projection, setProjection] = useState<Projection | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyNote, setKeyNote] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api.get<Models>("/api/system/models")
      .then(setModels)
      .catch(setError)
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  useEffect(() => {
    api.get<{ graph_projection: Projection }>("/api/system/capabilities")
      .then((c) => setProjection(c.graph_projection))
      .catch(() => setProjection(null));
  }, []);

  /**
   * Choose a model, confirming first if it is not this machine.
   *
   * The hosted provider already asks, on the grounds that it is "the one
   * action here that changes where data goes". An Ollama model tagged
   * `:cloud` changes where data goes just as completely and asked nothing,
   * because the check was written against the *provider* rather than against
   * where the model actually runs.
   */
  async function chooseModel(model: Installed) {
    if (model.runs_here === false) {
      const agreed = window.confirm(
        `${model.name} runs on ollama.com, not on this machine.\n\n`
        + "Every passage of every paper this system reads would be sent there, "
        + "along with the questions asked about them.\n\nUse it anyway?");
      if (!agreed) return;
    }
    await choose(model.name);
  }

  async function choose(name: string) {
    setSaving(name);
    setError(null);
    try {
      await api.put("/api/system/models", { provider: "ollama", model: name });
      load();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(null);
    }
  }

  /**
   * Move to the hosted model — the one action here that changes where data
   * goes, so it is confirmed rather than toggled.
   *
   * The server refuses if the key is missing or does not work, and reverts to
   * the previous selection rather than leaving the system pointed at a model
   * it cannot reach.
   */
  async function chooseHosted() {
    if (!models?.hosted) return;
    const agreed = window.confirm(
      `${models.hosted.warning}\n\n${models.hosted.billed}\n\n`
      + "Select the hosted model?");
    if (!agreed) return;

    setSaving(models.hosted.model);
    setError(null);
    try {
      await api.put("/api/system/models",
                    { provider: models.hosted.provider,
                      model: models.hosted.model });
      load();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(null);
    }
  }

  async function saveKey() {
    setKeyBusy(true);
    setError(null);
    setKeyNote(null);
    try {
      const result = await api.put<{ note: string }>(
        "/api/system/model-key", { api_key: keyInput });
      // Cleared from the field as soon as it is stored: a credential sitting
      // in a form is one a screenshot or a password manager can still pick up.
      setKeyInput("");
      setKeyNote(result.note);
      load();
    } catch (err) { setError(err); } finally { setKeyBusy(false); }
  }

  /*
   * §96. Removing the key was one click on a `btn-danger` labelled "Remove",
   * and the key was gone — a credential the researcher has to go back to the
   * provider for, and may not have kept anywhere else. `ConfirmDialog` was
   * already here for deleting a project; this is the same mechanism on the
   * other destructive control in the product.
   *
   * No typed confirmation, unlike a project. A key can be pasted again from
   * the place it came from; a corpus cannot be recovered from anywhere. Asking
   * someone to type a name to remove a replaceable credential is the kind of
   * ceremony that teaches people to click through the next dialog too.
   */
  const [askingRemoveKey, setAskingRemoveKey] = useState(false);

  async function removeKey() {
    setAskingRemoveKey(false);
    setKeyBusy(true);
    setError(null);
    setKeyNote(null);
    try {
      const result = await api.del<{ note: string }>("/api/system/model-key");
      setKeyNote(result.note);
      load();
    } catch (err) { setError(err); } finally { setKeyBusy(false); }
  }

  if (loading && !models) return <Loading rows={4} label="Asking what this machine has" />;

  return (
    <>
      <h1>Settings</h1>

      <section className="set-section">
        <h2>Model</h2>
        <p className="lede">
          Throughline runs against whichever model you point it at. The model
          reads papers and writes prose — it never writes a number or a
          verdict. Statistics come from executed code, comparability from
          deterministic checks, and every sentence it quotes is verified
          against the paper before it is kept, so an altered quote is discarded
          rather than shown.
        </p>
        <p className="lede">
          What does change with the model is how much it finds. A smaller one
          locates fewer of the sentences in a paper, and a field it misses is
          simply absent rather than flagged — so the trade is coverage, not
          correctness. Each extraction records the model that produced it.
        </p>

        {error ? <Failure error={error} /> : null}

        {models?.note && (
          <div className="notice">
            <span>{models.note}</span>
          </div>
        )}

        {models && models.installed.length === 0 && !models.note && (
          <div className="notice">
            <span>
              No model is installed. Install one with{" "}
              <code>{models.how_to_install}</code> and it will appear here.
            </span>
          </div>
        )}

        <div className="set-models">
          {models?.installed.map((model) => {
            // Exact match, or base-name match only when the selection carries
            // no tag at all. Matching on the base name unconditionally marked
            // every qwen2.5 variant as "in use" at once — two models both
            // claiming to be the running one, which is worse than none saying
            // so, because it looks authoritative.
            const selected = models.active.model;
            const active = selected === model.name
              || (!selected.includes(":")
                  && selected === model.name.split(":")[0]);
            return (
              <button
                key={model.name}
                className="set-model"
                data-active={active}
                disabled={saving !== null}
                onClick={() => void chooseModel(model)}
              >
                <span className="set-model-name">{model.name}</span>
                {model.runs_here === false && (
                  // On the choice itself, not only in the facts below it: this
                  // is the one thing about a model that cannot be undone after
                  // the fact, because by then the text has been sent.
                  <span className="set-remote">runs on ollama.com</span>
                )}
                <span className="set-model-meta numeric">
                  {[model.parameters, model.quantization, gigabytes(model.size_bytes)]
                    .filter(Boolean).join(" · ")}
                </span>
                {active && <span className="set-active">in use</span>}
                {saving === model.name && <span className="set-active">switching…</span>}
              </button>
            );
          })}
        </div>

        {models && (
          <dl className="set-facts">
            <div>
              <dt>Runs on</dt>
              {/* A privacy fact, not a performance one (§98). */}
              <dd>{models.active.local
                ? "this machine — nothing leaves it"
                : "a remote service — data leaves this machine"}</dd>
            </div>
            <div>
              <dt>Structured output</dt>
              <dd>{models.active.structured
                ? "supported"
                : "not supported — claim location will be unreliable"}</dd>
            </div>
            <div>
              <dt>Chosen</dt>
              <dd>{models.selection.source}</dd>
            </div>
          </dl>
        )}

        {models?.active.note && (
          <p className="set-note">{models.active.note}</p>
        )}

        {/*
          * The hosted option, stated rather than hidden.
          *
          * It was already built and reachable only through an environment
          * variable, which meant the one choice with a privacy consequence was
          * the one choice the interface would not discuss.
          *
          * Two things are said before anything else, because both are things a
          * researcher would otherwise discover too late: that text leaves the
          * machine, and that this is API billing rather than a Claude
          * subscription — there is no way for an application to spend one, and
          * learning that from an invoice would be the interface's fault.
          */}
        {models?.hosted && (
          <div className="set-hosted">
            <h3>Hosted model</h3>
            <p className="set-sub">{models.hosted.warning}</p>
            <p className="set-sub">{models.hosted.billed}</p>

            <div className="set-key">
              <label>
                API key
                <input
                  type="password"
                  aria-label="Anthropic API key"
                  autoComplete="off"
                  placeholder={models.hosted.key_saved
                    ? `saved ${models.hosted.key_hint ?? ""}`
                    : "not set"}
                  value={keyInput}
                  onChange={(event) => setKeyInput(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn"
                disabled={keyBusy || keyInput.trim().length === 0}
                onClick={() => void saveKey()}
              >
                {models.hosted.key_saved ? "Replace key" : "Save key"}
              </button>
              {models.hosted.key_saved && (
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={keyBusy}
                  onClick={() => setAskingRemoveKey(true)}
                >
                  Remove
                </button>
              )}
            </div>

            <ConfirmDialog
              open={askingRemoveKey}
              destructive
              title="Remove the saved API key?"
              body={
                <>
                  The key is deleted from this machine. Nothing else is
                  changed, and a key can be pasted in again at any time.
                </>
              }
              consequences={[
                "Anything that needs a hosted model stops until a key is set",
                "Local models, analyses and everything already recorded are "
                + "unaffected",
                "The key itself is not recoverable from here — it comes from "
                + "the provider",
              ]}
              confirmLabel="Remove key"
              busy={keyBusy}
              onConfirm={() => void removeKey()}
              onCancel={() => setAskingRemoveKey(false)}
            />

            {keyNote && <p className="set-note">{keyNote}</p>}

            <button
              type="button"
              className="set-model"
              data-active={models.selection.provider === models.hosted.provider}
              disabled={saving !== null || !models.hosted.key_saved}
              onClick={() => void chooseHosted()}
            >
              <span className="set-model-name">{models.hosted.model}</span>
              <span className="set-model-meta numeric">
                Anthropic · sends data off this machine
              </span>
              {models.selection.provider === models.hosted.provider
                && <span className="set-active">in use</span>}
            </button>

            {!models.hosted.key_saved && (
              <p className="set-note">
                Add a key to make this selectable. Saving one sends nothing —
                the local model stays in use until you choose otherwise.
              </p>
            )}
          </div>
        )}
      </section>

      {/* ADR 0002 — PostgreSQL is the record; Neo4j answers four traversal
          queries when it is there. Absence is a reduced feature set, never a
          broken record, and the wording has to make that unmistakable. */}
      {projection && (
        <section className="set-section">
          <h2>Graph queries</h2>
          <p className="set-sub">
            Provenance, evidence graphs and search are answered from PostgreSQL,
            which holds the record. Path-finding, influence ranking and
            clustering are answered from a rebuilt Neo4j projection when one is
            available.
          </p>

          <dl className="set-facts">
            <div>
              <dt>Projection</dt>
              <dd>
                {!projection.configured
                  ? "not configured"
                  : projection.reachable
                  ? `reachable · ${(projection.nodes ?? 0).toLocaleString()} objects, `
                    + `${(projection.edges ?? 0).toLocaleString()} relationships`
                  : "configured but unreachable"}
              </dd>
            </div>
            <div>
              <dt>Extra queries</dt>
              <dd>
                {projection.queries.length
                  ? projection.queries.map((q) => q.replace(/_/g, " ")).join(", ")
                  : "unavailable"}
              </dd>
            </div>
            {projection.built_at && (
              <div>
                <dt>Last rebuilt</dt>
                <dd>{new Date(projection.built_at).toLocaleString()}</dd>
              </div>
            )}
          </dl>
          <p className="set-note">{projection.note}</p>
        </section>
      )}

      <StartingPanel />

      <VersionPanel />

      <FeaturePacks />

      <Accounts />

      {models && models.history.length > 0 && (
        <section className="set-section">
          <h2>Changes</h2>
          <p className="set-sub">
            Swapping the model changes what the system writes, so the swaps are
            part of the record.
          </p>
          <ol className="set-history">
            {models.history.map((change, index) => (
              <li key={index}>
                <span className="numeric">
                  {new Date(change.changed_at).toLocaleString()}
                </span>
                <span>
                  {change.old_value?.model
                    ? `${change.old_value.model} → ${change.new_value.model}`
                    : `set to ${change.new_value.model}`}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
