import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { supabase } from "./lib/supabase";
import { ATTENDANCE_OPTIONS, US_STATES } from "./constants";
import { normalizeSchoolName, normalizeTown, stateOrEmpty, toLocalDateTimeInput } from "./utils";

function Page({ children, background }) {
  const navigate = useNavigate();
  return (
    <div className={background ? "page bg-page" : "page"}>
      <button className="back-btn" onClick={() => navigate(-1)}>Back</button>
      {children}
    </div>
  );
}

function Spinner({ label = "Loading..." }) {
  return (
    <div className="spinner-wrap" role="status" aria-live="polite">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  );
}

function Toast({ type = "info", message, onClose }) {
  if (!message) return null;
  return (
    <div className={`toast ${type}`}>
      <span>{message}</span>
      <button className="toast-close" onClick={onClose} aria-label="Close message">x</button>
    </div>
  );
}

function useToast() {
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(id);
  }, [toast]);
  return {
    toast,
    notify(type, message) {
      setToast({ type, message });
    },
    clear() {
      setToast(null);
    },
  };
}

async function upsertSchoolAndProfile(userId, email, schoolName, town, state, grade) {
  const normalizedSchool = normalizeSchoolName(schoolName);
  const normalizedTown = normalizeTown(town);
  const normalizedState = stateOrEmpty(state);

  const { data: existingSchool } = await supabase
    .from("schools")
    .select("id")
    .eq("name", normalizedSchool)
    .eq("town", normalizedTown)
    .eq("state", normalizedState)
    .maybeSingle();

  let schoolId = existingSchool?.id;
  if (!schoolId) {
    const { data: createdSchool, error: createSchoolErr } = await supabase
      .from("schools")
      .insert({
        name: normalizedSchool,
        town: normalizedTown,
        state: normalizedState,
      })
      .select("id")
      .single();
    if (createSchoolErr) throw createSchoolErr;
    schoolId = createdSchool.id;
  }

  const { error: profileErr } = await supabase.from("users").upsert({
    id: userId,
    email,
    school_id: schoolId,
    grade: Number(grade),
  });
  if (profileErr) throw profileErr;
}

function HomePage() {
  return (
    <Page background>
      <header className="top-actions">
        <Link className="btn secondary" to="/login?mode=login">Login</Link>
        <Link className="btn" to="/login?mode=signup">Sign Up</Link>
      </header>
      <section className="hero">
        <h1>musical-octo-meme</h1>
        <p>
          A multi-layered, collaboratively orchestrated ecosystem for
          inter-student organizational logistics, where school clubs can
          synchronize membership governance, event cadence design, and
          attendance prediction across institution-specific social networks.
        </p>
      </section>
    </Page>
  );
}

function AuthPage() {
  const navigate = useNavigate();
  const initialMode = new URLSearchParams(window.location.search).get("mode") === "signup" ? "signup" : "login";
  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState({
    email: "",
    password: "",
    schoolName: "",
    town: "",
    state: "",
    grade: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast, notify, clear } = useToast();

  const update = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (mode === "login") {
        const { error: loginErr } = await supabase.auth.signInWithPassword({
          email: form.email.trim(),
          password: form.password,
        });
        if (loginErr) throw loginErr;
      } else {
        const { data, error: signUpErr } = await supabase.auth.signUp({
          email: form.email.trim(),
          password: form.password,
        });
        if (signUpErr) throw signUpErr;
        if (data.user && data.session) {
          await upsertSchoolAndProfile(
            data.user.id,
            form.email.trim(),
            form.schoolName,
            form.town,
            form.state,
            form.grade
          );
        } else if (data.user && !data.session) {
          notify("info", "Check your email to verify your account, then log in to complete your profile.");
          navigate("/login?mode=login");
          return;
        }
      }
      notify("success", mode === "signup" ? "Account created. Redirecting to dashboard." : "Login successful.");
      navigate("/dashboard");
    } catch (err) {
      setError(err.message || "Could not authenticate");
      notify("error", err.message || "Could not authenticate.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Page>
      <div className="card narrow">
        <h2>{mode === "signup" ? "Create an account" : "Login"}</h2>
        <div className="switch-row">
          <button className={`btn ${mode === "login" ? "" : "secondary"}`} onClick={() => setMode("login")}>Login</button>
          <button className={`btn ${mode === "signup" ? "" : "secondary"}`} onClick={() => setMode("signup")}>Sign Up</button>
        </div>
        <form onSubmit={onSubmit} className="form">
          <label>Email / Username<input required name="email" type="email" value={form.email} onChange={update} /></label>
          <label>Password<input required name="password" type="password" minLength={8} value={form.password} onChange={update} /></label>
          {mode === "signup" && (
            <>
              <label>School<input required name="schoolName" value={form.schoolName} onChange={update} /></label>
              <label>Town<input required name="town" value={form.town} onChange={update} /></label>
              <label>State
                <select required name="state" value={form.state} onChange={update}>
                  <option value="">Select a state</option>
                  {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label>Grade<input required name="grade" type="number" min="1" max="12" value={form.grade} onChange={update} /></label>
            </>
          )}
          <button className="btn" disabled={loading}>{loading ? "Working..." : mode === "signup" ? "Create account" : "Login"}</button>
        </form>
        {error && <p className="error">{error}</p>}
        <Toast type={toast?.type} message={toast?.message} onClose={clear} />
      </div>
    </Page>
  );
}

function useAuthState() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, nextSession) => {
      setSession(nextSession);
    });
    return () => sub.subscription.unsubscribe();
  }, []);
  return { session, loading };
}

function ProtectedRoute({ children }) {
  const { session, loading } = useAuthState();
  if (loading) return <Page><p>Loading...</p></Page>;
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

function DashboardPage() {
  const navigate = useNavigate();
  const { session } = useAuthState();
  const [memberClubs, setMemberClubs] = useState([]);
  const [adminClubs, setAdminClubs] = useState([]);
  const [newClubOpen, setNewClubOpen] = useState(false);
  const dropdownRef = useRef(null);
  const [profile, setProfile] = useState(null);
  const [completeForm, setCompleteForm] = useState({ schoolName: "", town: "", state: "", grade: "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const { toast, notify, clear } = useToast();

  useEffect(() => {
    function handleClickOutside(event) {
      if (!dropdownRef.current) return;
      if (!dropdownRef.current.contains(event.target)) {
        setNewClubOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function loadDashboard() {
    const userId = session.user.id;
    const [{ data: membershipRows }, { data: profileRow }] = await Promise.all([
      supabase
        .from("memberships")
        .select("role, club:clubs(id, name, description, meeting_times, school_id, created_at)")
        .eq("user_id", userId),
      supabase.from("users").select("id, grade, school_id").eq("id", userId).maybeSingle(),
    ]);

    setProfile(profileRow);

    const clubs = (membershipRows || []).map((row) => ({ ...row.club, role: row.role }));
    const memberOnly = clubs.filter((c) => c.role === "member");
    const adminOnly = clubs.filter((c) => c.role === "admin");

    const { data: seenRows } = await supabase.from("club_event_reads").select("club_id, last_seen_at").eq("user_id", userId);
    const seenMap = new Map((seenRows || []).map((r) => [r.club_id, r.last_seen_at]));

    const clubIds = clubs.map((c) => c.id);
    const { data: latestEvents } = clubIds.length
      ? await supabase
          .from("events")
          .select("club_id, created_at")
          .in("club_id", clubIds)
          .order("created_at", { ascending: false })
      : { data: [] };

    const newestByClub = new Map();
    (latestEvents || []).forEach((evt) => {
      if (!newestByClub.has(evt.club_id)) newestByClub.set(evt.club_id, evt.created_at);
    });

    const markDot = (club) => {
      const newest = newestByClub.get(club.id);
      const seen = seenMap.get(club.id);
      return newest && (!seen || new Date(newest) > new Date(seen));
    };

    setMemberClubs(memberOnly.map((club) => ({ ...club, hasNew: markDot(club) })));
    setAdminClubs(adminOnly.map((club) => ({ ...club, hasNew: markDot(club) })));
  }

  useEffect(() => {
    if (session?.user) loadDashboard();
  }, [session?.user?.id]);

  async function completeProfile(e) {
    e.preventDefault();
    if (savingProfile) return;
    setSavingProfile(true);
    try {
      await upsertSchoolAndProfile(
        session.user.id,
        session.user.email,
        completeForm.schoolName,
        completeForm.town,
        completeForm.state,
        completeForm.grade
      );
      await loadDashboard();
      notify("success", "Profile saved.");
    } catch (err) {
      notify("error", err.message || "Could not save profile.");
    } finally {
      setSavingProfile(false);
    }
  }

  return (
    <Page>
      <div className="card">
        <div className="card-topbar">
          <div
            className="dropdown"
            ref={dropdownRef}
            onMouseLeave={() => setNewClubOpen(false)}
          >
            <button className="btn" onClick={() => setNewClubOpen((v) => !v)}>
              Add Clubs
            </button>
            {newClubOpen && (
              <div className="dropdown-menu">
                <Link className="dropdown-item" to="/create-club">Make a Club</Link>
                <Link className="dropdown-item" to="/join-club">Join a Club</Link>
              </div>
            )}
          </div>
        </div>
        <h2>Dashboard</h2>
        <p>Welcome to your club planning workspace.</p>
        {!profile?.school_id && (
          <form className="form inline-form" onSubmit={completeProfile}>
            <h3>Complete your profile</h3>
            <label>School<input required value={completeForm.schoolName} onChange={(e) => setCompleteForm((p) => ({ ...p, schoolName: e.target.value }))} /></label>
            <label>Town<input required value={completeForm.town} onChange={(e) => setCompleteForm((p) => ({ ...p, town: e.target.value }))} /></label>
            <label>State
              <select required value={completeForm.state} onChange={(e) => setCompleteForm((p) => ({ ...p, state: e.target.value }))}>
                <option value="">Select</option>
                {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label>Grade<input required type="number" min="1" max="12" value={completeForm.grade} onChange={(e) => setCompleteForm((p) => ({ ...p, grade: e.target.value }))} /></label>
            <button className="btn" disabled={savingProfile}>{savingProfile ? "Saving..." : "Save profile"}</button>
          </form>
        )}

        <div className="split">
          <div>
            <h3>Your Clubs</h3>
            {memberClubs.length === 0 ? <p>No memberships yet.</p> : memberClubs.map((club) => (
              <button key={club.id} className="list-btn" onClick={() => navigate(`/club/${club.id}`)}>
                {club.name} {club.hasNew && <span className="dot" />}
              </button>
            ))}
          </div>
          <div>
            <h3>Admin Clubs</h3>
            {adminClubs.length === 0 ? <p>No admin clubs yet.</p> : adminClubs.map((club) => (
              <button key={club.id} className="list-btn" onClick={() => navigate(`/club/${club.id}/admin`)}>
                {club.name} {club.hasNew && <span className="dot" />}
              </button>
            ))}
          </div>
        </div>
        <Toast type={toast?.type} message={toast?.message} onClose={clear} />
      </div>
    </Page>
  );
}

function CreateClubPage() {
  const navigate = useNavigate();
  const { session } = useAuthState();
  const [form, setForm] = useState({ name: "", description: "", meeting_times: "", school_id: "" });
  const [schools, setSchools] = useState([]);
  const [creatingClub, setCreatingClub] = useState(false);
  const { toast, notify, clear } = useToast();

  useEffect(() => {
    if (!session?.user) return;
    async function load() {
      const [{ data: profile }, { data: schoolRows }] = await Promise.all([
        supabase.from("users").select("school_id").eq("id", session.user.id).single(),
        supabase.from("schools").select("id, name, town, state").order("name"),
      ]);
      setSchools(schoolRows || []);
      setForm((f) => ({ ...f, school_id: profile?.school_id || "" }));
    }
    load();
  }, [session?.user?.id]);

  async function createClub(e) {
    e.preventDefault();
    if (creatingClub) return;
    setCreatingClub(true);
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData?.user?.id) {
      notify("error", "Your session expired. Please log in again.");
      setCreatingClub(false);
      navigate("/login?mode=login");
      return;
    }
    const currentUserId = authData.user.id;

    const { data: club, error: clubErr } = await supabase
      .from("clubs")
      .insert({
        name: form.name,
        description: form.description,
        meeting_times: form.meeting_times,
        school_id: form.school_id,
      })
      .select("id")
      .single();
    if (clubErr) {
      notify("error", clubErr.message || "Could not create club.");
      setCreatingClub(false);
      return;
    }

    const { error: membershipErr } = await supabase.from("memberships").insert({
      user_id: currentUserId,
      club_id: club.id,
      role: "admin",
    });
    if (membershipErr) {
      notify("error", membershipErr.message || "Could not set club admin role.");
      setCreatingClub(false);
      return;
    }
    notify("success", "Club created.");
    setCreatingClub(false);
    navigate(`/club/${club.id}/admin`);
  }

  return (
    <Page>
      <div className="card narrow">
        <h2>Make a Club</h2>
        <form className="form" onSubmit={createClub}>
          <label>Club name<input required value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></label>
          <label>Description<textarea required value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} /></label>
          <label>Regular meeting times<input required value={form.meeting_times} onChange={(e) => setForm((p) => ({ ...p, meeting_times: e.target.value }))} /></label>
          <label>School
            <select required value={form.school_id} onChange={(e) => setForm((p) => ({ ...p, school_id: e.target.value }))}>
              <option value="">Choose school</option>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>{s.name} - {s.town}, {s.state}</option>
              ))}
            </select>
          </label>
          <button className="btn" disabled={creatingClub}>{creatingClub ? "Creating..." : "Create club"}</button>
        </form>
        <Toast type={toast?.type} message={toast?.message} onClose={clear} />
      </div>
    </Page>
  );
}

function JoinClubPage() {
  const { session } = useAuthState();
  const [schools, setSchools] = useState([]);
  const [search, setSearch] = useState("");
  const [schoolId, setSchoolId] = useState("");
  const [clubs, setClubs] = useState([]);
  const [joiningClubId, setJoiningClubId] = useState(null);
  const { toast, notify, clear } = useToast();

  useEffect(() => {
    supabase.from("schools").select("id, name, town, state").order("name").then(({ data }) => setSchools(data || []));
  }, []);

  useEffect(() => {
    if (!schoolId) return setClubs([]);
    let query = supabase.from("clubs").select("id, name, description, meeting_times").eq("school_id", schoolId);
    if (search.trim()) query = query.ilike("name", `%${search.trim()}%`);
    query.order("name").then(({ data }) => setClubs(data || []));
  }, [schoolId, search]);

  async function joinClub(clubId) {
    if (joiningClubId === clubId) return;
    setJoiningClubId(clubId);
    const { data: exists } = await supabase
      .from("memberships")
      .select("id")
      .eq("user_id", session.user.id)
      .eq("club_id", clubId)
      .maybeSingle();
    if (exists) {
      notify("info", "You are already a member of this club.");
      setJoiningClubId(null);
      return;
    }

    const { error } = await supabase.from("memberships").insert({
      user_id: session.user.id,
      club_id: clubId,
      role: "member",
    });
    if (error) {
      notify("error", error.message || "Could not join club.");
      setJoiningClubId(null);
      return;
    }
    notify("success", "Joined club successfully.");
    setJoiningClubId(null);
  }

  return (
    <Page>
      <div className="card">
        <h2>Join a Club</h2>
        <label>School
          <input
            list="schools"
            placeholder="Type to search schools"
            onChange={(e) => {
              const match = schools.find((s) => `${s.name} - ${s.town}, ${s.state}` === e.target.value);
              setSchoolId(match?.id || "");
            }}
          />
          <datalist id="schools">
            {schools.map((s) => <option key={s.id} value={`${s.name} - ${s.town}, ${s.state}`} />)}
          </datalist>
        </label>
        <label>Search clubs<input value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <div className="grid">
          {clubs.map((club) => (
            <div className="card small" key={club.id}>
              <h3>{club.name}</h3>
              <p>{club.description}</p>
              <p><strong>Meets:</strong> {club.meeting_times}</p>
              <button
                className="btn secondary"
                onClick={() => joinClub(club.id)}
                disabled={joiningClubId === club.id}
              >
                {joiningClubId === club.id ? "Joining..." : "Join"}
              </button>
            </div>
          ))}
        </div>
        <Toast type={toast?.type} message={toast?.message} onClose={clear} />
      </div>
    </Page>
  );
}

function ClubPage() {
  const { id } = useParams();
  const { session } = useAuthState();
  const [events, setEvents] = useState([]);
  const [attendanceMap, setAttendanceMap] = useState({});
  const [updatingAttendanceId, setUpdatingAttendanceId] = useState(null);
  const { toast, notify, clear } = useToast();

  async function load() {
    const [{ data: eventRows }, { data: attendanceRows }] = await Promise.all([
      supabase.from("events").select("id, name, date, location").eq("club_id", id).order("date"),
      supabase
        .from("attendance")
        .select("event_id, status")
        .eq("user_id", session.user.id),
    ]);
    setEvents(eventRows || []);
    const map = {};
    (attendanceRows || []).forEach((r) => {
      map[r.event_id] = r.status;
    });
    setAttendanceMap(map);
  }

  useEffect(() => {
    if (session?.user) load();
  }, [id, session?.user?.id]);

  useEffect(() => {
    if (!session?.user) return;
    supabase.from("club_event_reads").upsert({ user_id: session.user.id, club_id: id, last_seen_at: new Date().toISOString() });
  }, [id, session?.user?.id]);

  async function setAttendance(eventId, status) {
    if (updatingAttendanceId === eventId) return;
    const previous = attendanceMap[eventId] || "maybe";
    setUpdatingAttendanceId(eventId);
    setAttendanceMap((prev) => ({ ...prev, [eventId]: status }));
    const { error } = await supabase.from("attendance").upsert({
      user_id: session.user.id,
      event_id: eventId,
      status,
    });
    if (error) {
      setAttendanceMap((prev) => ({ ...prev, [eventId]: previous }));
      notify("error", error.message || "Could not update attendance.");
      setUpdatingAttendanceId(null);
      return;
    }
    notify("success", "Attendance updated.");
    setUpdatingAttendanceId(null);
  }

  return (
    <Page>
      <div className="card">
        <h2>Club Events</h2>
        {events.map((event) => (
          <div key={event.id} className="card small">
            <h3>{event.name}</h3>
            <p>{new Date(event.date).toLocaleString()} - {event.location}</p>
            <label>Your attendance
              <select
                value={attendanceMap[event.id] || "maybe"}
                onChange={(e) => setAttendance(event.id, e.target.value)}
                disabled={updatingAttendanceId === event.id}
              >
                {ATTENDANCE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>
        ))}
        <Toast type={toast?.type} message={toast?.message} onClose={clear} />
      </div>
    </Page>
  );
}

function ClubAdminPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { session } = useAuthState();
  const [events, setEvents] = useState([]);
  const [members, setMembers] = useState([]);
  const [eventForm, setEventForm] = useState({ name: "", date: "", location: "" });
  const [attendanceMap, setAttendanceMap] = useState({});
  const [accessChecked, setAccessChecked] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [addingEvent, setAddingEvent] = useState(false);
  const [updatingEventId, setUpdatingEventId] = useState(null);
  const [promotingId, setPromotingId] = useState(null);
  const [updatingAttendanceId, setUpdatingAttendanceId] = useState(null);
  const { toast, notify, clear } = useToast();

  const isValid = useMemo(() => eventForm.name && eventForm.date && eventForm.location, [eventForm]);

  async function load() {
    setPageLoading(true);
    const { data: myMembership } = await supabase
      .from("memberships")
      .select("role")
      .eq("club_id", id)
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (!myMembership || myMembership.role !== "admin") {
      navigate(`/club/${id}`, { replace: true });
      return;
    }

    const [{ data: eventRows }, { data: memberRows }, { data: attendanceRows }] = await Promise.all([
      supabase.from("events").select("id, name, date, location").eq("club_id", id).order("date"),
      supabase
        .from("memberships")
        .select("id, role, user_id, user:users(email)")
        .eq("club_id", id),
      supabase.from("attendance").select("event_id, status").eq("user_id", session.user.id),
    ]);
    setEvents(eventRows || []);
    setMembers(memberRows || []);
    const map = {};
    (attendanceRows || []).forEach((row) => {
      map[row.event_id] = row.status;
    });
    setAttendanceMap(map);
    setAccessChecked(true);
    setPageLoading(false);
  }

  useEffect(() => {
    if (session?.user) load();
  }, [id, session?.user?.id]);

  useEffect(() => {
    if (!session?.user) return;
    supabase.from("club_event_reads").upsert({ user_id: session.user.id, club_id: id, last_seen_at: new Date().toISOString() });
  }, [id, session?.user?.id]);

  async function addEvent() {
    if (addingEvent) return;
    setAddingEvent(true);
    const { error } = await supabase.from("events").insert({
      club_id: id,
      name: eventForm.name,
      date: new Date(eventForm.date).toISOString(),
      location: eventForm.location,
    });
    if (error) {
      notify("error", error.message || "Could not add event.");
      setAddingEvent(false);
      return;
    }
    setEventForm({ name: "", date: "", location: "" });
    notify("success", "Event added.");
    await load();
    setAddingEvent(false);
  }

  async function updateEvent(eventId, patch) {
    if (updatingEventId === eventId) return;
    setUpdatingEventId(eventId);
    const { error } = await supabase.from("events").update(patch).eq("id", eventId);
    if (error) {
      notify("error", error.message || "Could not update event.");
      setUpdatingEventId(null);
      return;
    }
    notify("success", "Event updated.");
    await load();
    setUpdatingEventId(null);
  }

  async function promote(memberId) {
    if (promotingId === memberId) return;
    setPromotingId(memberId);
    const { error } = await supabase.from("memberships").update({ role: "admin" }).eq("id", memberId);
    if (error) {
      notify("error", error.message || "Could not promote member.");
      setPromotingId(null);
      return;
    }
    notify("success", "Member promoted to admin.");
    await load();
    setPromotingId(null);
  }

  async function setAttendance(eventId, status) {
    if (updatingAttendanceId === eventId) return;
    const previous = attendanceMap[eventId] || "maybe";
    setUpdatingAttendanceId(eventId);
    setAttendanceMap((prev) => ({ ...prev, [eventId]: status }));
    const { error } = await supabase.from("attendance").upsert({ user_id: session.user.id, event_id: eventId, status });
    if (error) {
      setAttendanceMap((prev) => ({ ...prev, [eventId]: previous }));
      notify("error", error.message || "Could not update attendance.");
      setUpdatingAttendanceId(null);
      return;
    }
    notify("success", "Attendance updated.");
    setUpdatingAttendanceId(null);
  }

  if (!accessChecked || pageLoading) {
    return (
      <Page>
        <div className="card">
          <Spinner label="Checking admin access..." />
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <div className="card">
        <h2>Club Admin</h2>
        <div className="split">
          <section>
            <h3>Schedule events or meetings</h3>
            <div className="form inline-form">
              <label>Name<input value={eventForm.name} onChange={(e) => setEventForm((p) => ({ ...p, name: e.target.value }))} /></label>
              <label>Date<input type="datetime-local" value={eventForm.date} onChange={(e) => setEventForm((p) => ({ ...p, date: e.target.value }))} /></label>
              <label>Location<input value={eventForm.location} onChange={(e) => setEventForm((p) => ({ ...p, location: e.target.value }))} /></label>
              <button className="btn" onClick={addEvent} disabled={!isValid || addingEvent}>
                {addingEvent ? "Adding..." : "Add event"}
              </button>
            </div>
          </section>
          <section>
            <h3>Manage People</h3>
            {members.map((m) => (
              <div key={m.id} className="row">
                <span>{m.user?.email || m.user_id} ({m.role})</span>
                {m.role !== "admin" && (
                  <button className="btn secondary" onClick={() => promote(m.id)} disabled={promotingId === m.id}>
                    {promotingId === m.id ? "Promoting..." : "Make admin"}
                  </button>
                )}
              </div>
            ))}
          </section>
        </div>

        <h3>Events and meetings</h3>
        {events.map((event) => (
          <div key={event.id} className="card small">
            <label>Name<input value={event.name} onChange={(e) => setEvents((prev) => prev.map((ev) => ev.id === event.id ? { ...ev, name: e.target.value } : ev))} onBlur={() => updateEvent(event.id, { name: event.name })} disabled={updatingEventId === event.id} /></label>
            <label>Date<input type="datetime-local" value={toLocalDateTimeInput(event.date)} onChange={(e) => updateEvent(event.id, { date: new Date(e.target.value).toISOString() })} disabled={updatingEventId === event.id} /></label>
            <label>Location<input value={event.location} onChange={(e) => setEvents((prev) => prev.map((ev) => ev.id === event.id ? { ...ev, location: e.target.value } : ev))} onBlur={() => updateEvent(event.id, { location: event.location })} disabled={updatingEventId === event.id} /></label>
            <label>Your attendance
              <select value={attendanceMap[event.id] || "maybe"} onChange={(e) => setAttendance(event.id, e.target.value)} disabled={updatingAttendanceId === event.id}>
                {ATTENDANCE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>
        ))}
        <Toast type={toast?.type} message={toast?.message} onClose={clear} />
      </div>
    </Page>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<AuthPage />} />
      <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
      <Route path="/create-club" element={<ProtectedRoute><CreateClubPage /></ProtectedRoute>} />
      <Route path="/join-club" element={<ProtectedRoute><JoinClubPage /></ProtectedRoute>} />
      <Route path="/club/:id" element={<ProtectedRoute><ClubPage /></ProtectedRoute>} />
      <Route path="/club/:id/admin" element={<ProtectedRoute><ClubAdminPage /></ProtectedRoute>} />
    </Routes>
  );
}
