import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import en from "../../messages/en.json";
import ko from "../../messages/ko.json";
import type { ProfessorNotesContent, StudyGuideContent } from "@/lib/api";
import { renderWithProviders, requestBody, stubApi } from "@/test/auth-helpers";
import { LearningTools } from "./learning-tools";

const L = en.Learning;
const BASE = "/api/ventures/v1/stages/customer_definition/learning";

const NOTES: ProfessorNotesContent = {
  kind: "professor_notes",
  stage_slug: "customer_definition",
  language: "en",
  generated_at: "2026-10-21T09:00:00Z",
  overview: "Who the customer is decides everything else.",
  learning_objectives: ["Define a segment", "Find the buying trigger"],
  core_concepts: [
    { name: "Customer segment", explanation: "A group with a shared need.", why_it_matters: "Focus." },
    { name: "Early adopters", explanation: "Those who feel the pain most.", why_it_matters: "First sales." },
  ],
  frameworks: [{ name: "Jobs to Be Done", how_to_use: "Ask what job the customer hires a product for." }],
  teaching_plan: [
    { minutes: 10, activity: "Warm-up" },
    { minutes: 35, activity: "Segment mapping" },
  ],
  discussion_questions: ["Who feels the problem most?", "What triggers a purchase?"],
  common_misconceptions: [{ misconception: "Everyone is a customer.", correction: "Pick one segment first." }],
  class_activity: { title: "Segment sprint", instructions: ["Pair up", "Map segments"], deliverable: "A one-page segment profile" },
  assessment_ideas: ["Exit ticket"],
  example_from_this_venture: "Busy dual-income parents in Seoul.",
};

const GUIDE: StudyGuideContent = {
  kind: "study_guide",
  stage_slug: "customer_definition",
  language: "en",
  generated_at: "2026-10-21T09:00:00Z",
  overview: "Learn to describe your first customers.",
  learning_objectives: ["Know the terms", "Write a segment"],
  key_terms: [
    { term: "Segment", definition: "A group with a shared need." },
    { term: "Trigger", definition: "What makes them buy now." },
  ],
  concepts_explained: [
    { concept: "Segments", explanation: "Group people by need.", example: "New parents." },
    { concept: "Triggers", explanation: "A moment of need.", example: "Moving house." },
  ],
  worked_example: "This venture's first segment: busy parents.",
  self_check: [
    { question: "Which is a segment?", options: ["Everyone", "New parents in Seoul"], answer_index: 1, explanation: "It's specific." },
    { question: "A trigger is…", options: ["A moment of need", "A logo"], answer_index: 0, explanation: "It prompts buying." },
    { question: "Pick early adopters by…", options: ["Pain", "Age"], answer_index: 0, explanation: "They feel it most." },
  ],
  practice_exercise: { task: "Write your segment", steps: ["List groups", "Pick one"], success_criteria: ["One sentence"] },
  summary_points: ["Be specific", "Find the trigger"],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderTools(locale: "en" | "ko" = "en") {
  renderWithProviders(
    <LearningTools ventureId="v1" stageSlug="customer_definition" stageTitle="Stage 3: Customer" language={locale} />,
    locale,
  );
}

describe("LearningTools", () => {
  it("shows Professor Notes and Study Guide icons", () => {
    stubApi({});
    renderTools();
    const tools = screen.getByTestId("learning-tools");
    expect(within(tools).getByRole("button", { name: L.professor_notes.title })).toHaveAttribute("title", L.professor_notes.hint);
    expect(within(tools).getByRole("button", { name: L.study_guide.title })).toBeInTheDocument();
    expect(tools.querySelectorAll("svg")).toHaveLength(2);
  });

  it("opens saved Professor Notes without writing them again", async () => {
    const fetchMock = stubApi({ [`${BASE}/professor_notes?language=en`]: { body: NOTES } });
    renderTools();
    fireEvent.click(screen.getByRole("button", { name: L.professor_notes.title }));

    const panel = await screen.findByRole("dialog", { name: L.professor_notes.title });
    expect(await within(panel).findByText(NOTES.overview)).toBeInTheDocument();
    expect(panel).toHaveTextContent("Jobs to Be Done");
    expect(panel).toHaveTextContent("35 min");
    expect(panel).toHaveTextContent("Everyone is a customer.");
    expect(panel).toHaveTextContent(NOTES.example_from_this_venture);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("writes the Study Guide the first time, in the page's language", async () => {
    const fetchMock = stubApi({
      [`${BASE}/study_guide?language=en`]: { status: 404, body: { detail: "not_generated" } },
      [`${BASE}/study_guide`]: { body: GUIDE },
    });
    renderTools();
    fireEvent.click(screen.getByRole("button", { name: L.study_guide.title }));

    const panel = await screen.findByRole("dialog", { name: L.study_guide.title });
    expect(await within(panel).findByText(GUIDE.overview)).toBeInTheDocument();
    expect(requestBody(fetchMock, `${BASE}/study_guide`)).toEqual({ language: "en" });
    expect(panel).toHaveTextContent("Segment");
    expect(panel).toHaveTextContent(GUIDE.worked_example);
  });

  it("checks quiz answers and explains them", async () => {
    stubApi({ [`${BASE}/study_guide?language=en`]: { body: GUIDE } });
    renderTools();
    fireEvent.click(screen.getByRole("button", { name: L.study_guide.title }));
    const quiz = await screen.findByTestId("quiz-0");

    fireEvent.click(within(quiz).getByLabelText("Everyone"));
    expect(within(quiz).getByRole("status")).toHaveTextContent('Not quite — the answer is "New parents in Seoul". It\'s specific.');
    fireEvent.click(within(quiz).getByLabelText("New parents in Seoul"));
    expect(within(quiz).getByRole("status")).toHaveTextContent(L.guide.correct);
  });

  it("writes again on request", async () => {
    let calls = 0;
    stubApi({
      [`${BASE}/professor_notes?language=en`]: { body: NOTES },
      [`${BASE}/professor_notes`]: () => {
        calls += 1;
        return { body: { ...NOTES, overview: "A fresh take." } };
      },
    });
    renderTools();
    fireEvent.click(screen.getByRole("button", { name: L.professor_notes.title }));
    const panel = await screen.findByRole("dialog");
    fireEvent.click(await within(panel).findByRole("button", { name: L.regenerate }));
    expect(await within(panel).findByText("A fresh take.")).toBeInTheDocument();
    expect(calls).toBe(1);
  });

  it("shows the token-limit message when writing is refused", async () => {
    stubApi({
      [`${BASE}/study_guide?language=en`]: { status: 404, body: { detail: "not_generated" } },
      [`${BASE}/study_guide`]: { status: 429, body: { detail: "venture_token_limit" } },
    });
    renderTools();
    fireEvent.click(screen.getByRole("button", { name: L.study_guide.title }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(en.TokenLimit.venture));
  });

  it("speaks Korean", async () => {
    stubApi({ [`${BASE}/professor_notes?language=ko`]: { body: { ...NOTES, language: "ko" } } });
    renderTools("ko");
    fireEvent.click(screen.getByRole("button", { name: ko.Learning.professor_notes.title }));
    const panel = await screen.findByRole("dialog", { name: ko.Learning.professor_notes.title });
    expect(await within(panel).findByText(ko.Learning.notes.concepts)).toBeInTheDocument();
  });
});
