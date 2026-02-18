// Local, readable implementation of the Sighthound Savings Analyzer logic

const state = {
  step: 1,
  // `scenario` encodes buyer intent from Step 1: "A" | "B" | "C".
  scenario: "", // A: smart/AI replacement, B: add analytics to existing IP, C: new deployment
  // `cameraType` is retained for backwards-compatibility and also stores the raw option value
  // ("scenario-a" | "scenario-b" | "scenario-c").
  cameraType: "",
  // Scenario A sub-option: "recommended" (Standard IP + Nodes) or "smart" (Smart cameras only)
  scenarioAOption: "recommended",
  standardCameras: 1,
  smartCameras: 0,
  computeNodes: 0,
  autoAddNodes: false,
  software: [],
  currentMonthly: 0,
  currentUpfront: 0,
  frequency: "monthly",
  timeframe: 12,
};

const PRICES = {
  standardCamera: 250,
  smartCamera: 3000,
  node: 3500,
};

const CAMERAS_PER_NODE = 4;

const progressFill = document.getElementById("progressFill");
const progressText = document.getElementById("progressText");
const calculatorSection = document.getElementById("calculator");
const resultsSection = document.getElementById("results");

// ---------- INIT (safe even if script loads late) ----------
let __savings_init_done = false;
function init() {
  if (__savings_init_done) return;
  __savings_init_done = true;

  console.log("[savings] init");
  attachEventHandlers();
  updateCamerasAndNodes();
  updateSelectedSoftware();
  updateContinueStep3State();
  goToStep(1);

  // Signal to external test harnesses that initialization completed
  try { window.__savings_init_done = true; } catch (e) {}
}

// Ensure init runs after DOM is ready in all environments (guarded against double-run)
document.addEventListener("DOMContentLoaded", init);
window.addEventListener("load", init);
// If script executes after load, run immediately
if (document.readyState !== "loading") setTimeout(init, 0);

// ---------- IFRAME HEIGHT COMMUNICATION ----------
// Send height updates to parent frame so iframe can auto-resize
function notifyParentOfHeight() {
  if (window.parent !== window) {
    try {
      const height = document.documentElement.scrollHeight;
      window.parent.postMessage({ height }, "*");
    } catch (e) {
      // Silently fail if cross-origin restrictions prevent postMessage
    }
  }
}

// Notify parent on load and whenever content size changes
window.addEventListener("load", notifyParentOfHeight);
if (typeof ResizeObserver !== "undefined") {
  const resizeObserver = new ResizeObserver(notifyParentOfHeight);
  resizeObserver.observe(document.body);
}

// ---------- HELPERS ----------
function onClick(id, handler) {
  const el = document.getElementById(id);
  if (!el) return;
  console.log(`[savings] attaching click for #${id}`);
  el.addEventListener("click", (e) => {
    // Prevent form submit / anchor behavior from breaking step nav
    e.preventDefault();
    handler(e);
  });
}

// Step 1 scenario helpers
function isScenarioA() {
  return state.scenario === "A";
}
function isScenarioB() {
  return state.scenario === "B";
}
function isScenarioC() {
  return state.scenario === "C";
}

// Optional, derived "assumption mode" for readability in logs and branching
// A → "replace", B → "reuse", C → "new".
function getScenarioMode() {
  if (isScenarioA()) return "replace";
  if (isScenarioB()) return "reuse";
  if (isScenarioC()) return "new";
  return "";
}

function setScenarioFromCameraType(value) {
  state.cameraType = value || "";
  if (value === "scenario-a") state.scenario = "A";
  else if (value === "scenario-b") state.scenario = "B";
  else if (value === "scenario-c") state.scenario = "C";
  else state.scenario = "";
}

function applyScenarioBehavior() {
  // Step 2 hardware controls and helper copy
  const stdInput = document.getElementById("standardCameras");
  const smartInput = document.getElementById("smartCameras");
  const stdButtons = document.querySelectorAll('[data-target="standardCameras"]');
  const smartButtons = document.querySelectorAll('[data-target="smartCameras"]');
  const hardwareConfig = document.querySelector(".hardware-config");
  const step4 = document.getElementById("step4");
  const step2Helper = document.querySelector("#step2 .step-helper");
  const smartHardwareItem = smartInput ? smartInput.closest(".hardware-item") : null;
  const stdHardwareItem = stdInput ? stdInput.closest(".hardware-item") : null;
  const stdPriceEl = document.querySelector("#step2 .hardware-item .hardware-price");
  const scenarioAOptions = document.getElementById("scenarioAOptions");
  const autoAddSection = document.querySelector(".auto-add-section");
  const computeNodesItem = document.getElementById("computeNodes")?.closest(".hardware-item");

  const inScenarioB = isScenarioB();

  // Show/hide Scenario A sub-options
  if (scenarioAOptions) {
    scenarioAOptions.style.display = isScenarioA() ? "block" : "none";
  }

  // Scenario-specific helper copy for Step 2
  if (step2Helper) {
    if (isScenarioA()) {
      step2Helper.textContent = "Choose your replacement setup and configure quantities.";
    } else if (inScenarioB) {
      step2Helper.textContent = "How many Standard IP cameras will you reuse?";
    } else if (isScenarioC()) {
      step2Helper.textContent = "How many cameras do you need for this new deployment?";
    } else {
      step2Helper.textContent = "Select the camera types and quantities you need.";
    }
  }

  // Scenario-specific pricing label for Standard IP cameras in Step 2
  if (stdPriceEl) {
    if (inScenarioB) {
      // Scenario B: reuse path – do not show $250 price for existing Standard IP cameras
      stdPriceEl.textContent = "Existing hardware (already owned)";
    } else {
      // Other scenarios: show normal unit price
      stdPriceEl.textContent = "$250 each";
    }
  }

  // Default: everything enabled & visible (scenario branches may hide elements)
  if (stdInput) stdInput.disabled = false;
  if (smartInput) smartInput.disabled = false;
  stdButtons.forEach((b) => {
    b.disabled = false;
    b.style.opacity = "1";
    b.style.cursor = "pointer";
  });
  smartButtons.forEach((b) => {
    b.disabled = false;
    b.style.opacity = "1";
    b.style.cursor = "pointer";
  });
  if (hardwareConfig) hardwareConfig.style.opacity = "1";
  if (step4) step4.style.display = "";
  if (smartHardwareItem) smartHardwareItem.style.display = "";
  if (stdHardwareItem) stdHardwareItem.style.display = "";
  if (autoAddSection) autoAddSection.style.display = "";
  if (computeNodesItem) computeNodesItem.style.display = "";

  // Normalize camera counts based on current inputs
  const stdCount = stdInput ? parseInt(stdInput.value, 10) || 0 : state.standardCameras;
  const smartCount = smartInput ? parseInt(smartInput.value, 10) || 0 : state.smartCameras;
  const totalCameras = stdCount + smartCount;

  // Scenario A (replace): apply sub-option behavior
  if (isScenarioA()) {
    const cameraCount = totalCameras > 0 ? totalCameras : Math.max(1, state.standardCameras + state.smartCameras);
    
    if (state.scenarioAOption === "recommended") {
      // Recommended setup: Standard IP cameras + Compute Nodes
      state.standardCameras = cameraCount;
      state.smartCameras = 0;
      if (stdInput) stdInput.value = String(state.standardCameras);
      if (smartInput) smartInput.value = "0";
      // Hide smart cameras, show standard + nodes
      if (smartHardwareItem) smartHardwareItem.style.display = "none";
      if (stdHardwareItem) stdHardwareItem.style.display = "";
      if (autoAddSection) autoAddSection.style.display = "";
      if (computeNodesItem) computeNodesItem.style.display = "";
    } else {
      // Smart/AI setup: Smart cameras only, no nodes needed
      state.smartCameras = cameraCount;
      state.standardCameras = 0;
      if (smartInput) smartInput.value = String(state.smartCameras);
      if (stdInput) stdInput.value = "0";
      // Hide standard cameras and nodes, show smart cameras
      if (stdHardwareItem) stdHardwareItem.style.display = "none";
      if (smartHardwareItem) smartHardwareItem.style.display = "";
      if (autoAddSection) autoAddSection.style.display = "none";
      if (computeNodesItem) computeNodesItem.style.display = "none";
      // Clear nodes since not needed for smart cameras
      state.computeNodes = 0;
      const computeNodesInput = document.getElementById("computeNodes");
      if (computeNodesInput) computeNodesInput.value = "0";
    }
    updateCamerasAndNodes();
  }

  // Scenario B (reuse / upgrade): always treat Standard IP cameras as existing hardware
  // and hide Smart camera purchase UI in the primary path.
  if (inScenarioB) {
    const cameraCount = totalCameras > 0 ? totalCameras : state.standardCameras + state.smartCameras;
    state.standardCameras = cameraCount;
    state.smartCameras = 0;
    if (stdInput) stdInput.value = String(state.standardCameras);
    if (smartInput) smartInput.value = "0";
    if (smartHardwareItem) smartHardwareItem.style.display = "none";
    updateCamerasAndNodes();
  }

  if (isScenarioC()) {
    // Scenario C — new deployment; show both Standard IP and Smart camera options.
    // Both camera types and nodes are available for selection.
    if (smartHardwareItem) smartHardwareItem.style.display = "";
    if (stdHardwareItem) stdHardwareItem.style.display = "";
    if (autoAddSection) autoAddSection.style.display = "";
    if (computeNodesItem) computeNodesItem.style.display = "";
    updateCamerasAndNodes();

    // Scenario C — no current-cost step.
    if (step4) step4.style.display = "none";
    // Clear any current-cost values, since they are not relevant here.
    state.currentMonthly = 0;
    state.currentUpfront = 0;
    const currentMonthlyInput = document.getElementById("currentMonthly");
    const currentUpfrontInput = document.getElementById("currentUpfront");
    if (currentMonthlyInput) currentMonthlyInput.value = "";
    if (currentUpfrontInput) currentUpfrontInput.value = "";
  }
}

// ---------- EVENT HANDLERS ----------
function attachEventHandlers() {
  // Delegated handlers to ensure clicks are handled even if elements
  // are added/available later in some environments
  document.body.addEventListener("click", (e) => {
    const btn = e.target.closest && e.target.closest("button, a");
    if (!btn) return;

    if (btn.id === "continueStep2") {
      e.preventDefault();
      // OPTION C — require at least one camera or one node before advancing
      const totalCameras =
        (parseInt(document.getElementById("standardCameras")?.value, 10) || 0) +
        (parseInt(document.getElementById("smartCameras")?.value, 10) || 0);
      const totalNodes = parseInt(document.getElementById("computeNodes")?.value, 10) || 0;
      if (isScenarioC() && totalCameras === 0 && totalNodes === 0) {
        alert("Please enter at least one camera or one compute node for a new deployment.");
        return;
      }
      // After camera config, go to software step.
      // C: logical 2 → 3; A/B: logical 3 → 4.
      if (isScenarioC()) {
        goToScenarioStep(3);
      } else {
        goToScenarioStep(4);
      }
      return;
    }

    if (btn.id === "continueStep3") {
      e.preventDefault();
      updateSelectedSoftware();
      updateContinueStep3State();
      if (state.software.length === 0) return;
      // All scenarios go straight to the calculate step after software.
      goToScenarioStep(5);
      return;
    }

    if (btn.id === "skipStep3") {
      e.preventDefault();
      // Clear any selected software and advance — software is optional
      console.log('[savings] skipStep3 clicked: clearing software and advancing');
      document.querySelectorAll('#step3 input[name="software"]').forEach((input) => {
        input.checked = false;
      });
      state.software = [];
      updateContinueStep3State();
      // Skip directly to calculate step for all scenarios.
      goToScenarioStep(5);
      return;
    }

    if (btn.id === "continueStep4") {
      e.preventDefault();
      // For A/B, Step 4 (current costs) is logical Step 2; next is camera config (logical 3).
      // For C (if ever shown), treat it as the original Step 4 and go to calculate.
      if (isScenarioA() || isScenarioB()) {
        goToScenarioStep(3);
      } else {
        goToScenarioStep(5);
      }
      return;
    }

    // Back buttons (allow going back to previous steps to edit responses)
    if (btn.id === "backStep2") {
      e.preventDefault();
      // From camera config, go back to the immediately prior logical step:
      // - Scenario C: cameras are logical Step 2 → back to Step 1 (scenario picker).
      // - Scenarios A/B: cameras are logical Step 3 → back to Step 2 (current costs).
      if (isScenarioC()) {
        goToScenarioStep(1);
      } else {
        goToScenarioStep(2);
      }
      return;
    }

    if (btn.id === "backStep3") {
      e.preventDefault();
      // From software, go back to camera config in all scenarios.
      // C: logical 3 → 2; A/B: logical 4 → 3.
      if (isScenarioC()) {
        goToScenarioStep(2);
      } else {
        goToScenarioStep(3);
      }
      return;
    }

    if (btn.id === "backStep4") {
      e.preventDefault();
      // For A/B, Step 4 is logical Step 2; go back to Step 1.
      // For C (original order), go back to software (logical 3).
      if (isScenarioA() || isScenarioB()) {
        goToScenarioStep(1);
      } else {
        goToScenarioStep(3);
      }
      return;
    }

    if (btn.id === "backStep5") {
      e.preventDefault();
      // Go back to the previous logical step's content:
      // - Scenario C: calculate (5) → software (3)
      // - Scenarios A/B: calculate (5) → software (4)
      if (isScenarioC()) {
        goToScenarioStep(3);
      } else {
        goToScenarioStep(4);
      }
      return;
    }

    if (btn.id === "calculateButton") {
      e.preventDefault();
      runAnalysis();
      return;
    }

    if (btn.id === "editAnswers") {
      e.preventDefault();
      resultsSection?.classList.remove("active");
      goToStep(1);
      calculatorSection?.scrollIntoView({ behavior: "smooth" });
      return;
    }

    if (btn.id === "startOver") {
      e.preventDefault();
      window.location.reload();
      return;
    }
  });
  // Scroll to calculator + show step 1
  onClick("startAnalysis", () => {
    resultsSection?.classList.remove("active");
    goToScenarioStep(1);
    calculatorSection?.scrollIntoView({ behavior: "smooth" });
  });

  // Step 1: camera scenario
  const step1Options = document.querySelectorAll("#step1 .option-card");
  console.log(`[savings] step1 option count: ${step1Options.length}`);
  step1Options.forEach((btn, idx) => {
    console.log(`[savings] attaching step1 option handler #${idx} dataset=${btn.dataset.value}`);
    btn.addEventListener("click", (e) => {
      console.log(`[savings] step1 option clicked dataset=${btn.dataset.value}`);
      e.preventDefault();
      setScenarioFromCameraType(btn.dataset.value || "");

      // Scenario B reset rules when user switches into this path
      if (isScenarioB()) {
        // Reset Smart cameras to 0 for reuse path
        state.smartCameras = 0;
        const smartInputEl = document.getElementById("smartCameras");
        if (smartInputEl) smartInputEl.value = "0";
        // Keep auto-add nodes OFF and nodes at 0 by default
        state.autoAddNodes = false;
        state.computeNodes = 0;
        const autoToggle = document.getElementById("autoAddNodes");
        if (autoToggle) autoToggle.checked = false;
        const computeNodesInput = document.getElementById("computeNodes");
        if (computeNodesInput) computeNodesInput.value = "0";
      }

      selectOptionCard(btn);
      console.log(`[savings] scenario set to ${state.scenario} (mode=${getScenarioMode()}), cameraType=${state.cameraType}`);
      applyScenarioBehavior();
      // After picking a scenario, advance to logical Step 2 (scenario-aware mapping).
      goToScenarioStep(2);
    });
  });

  // Scenario A sub-options (recommended vs smart setup)
  const scenarioAOptionCards = document.querySelectorAll("#scenarioAOptions .option-card");
  scenarioAOptionCards.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const value = btn.dataset.value;
      if (!value) return;
      
      // Update state
      state.scenarioAOption = value;
      console.log(`[savings] Scenario A sub-option set to: ${value}`);
      
      // Update selected state on cards
      scenarioAOptionCards.forEach((card) => card.classList.remove("selected"));
      btn.classList.add("selected");
      
      // Re-apply scenario behavior to show/hide appropriate hardware
      applyScenarioBehavior();
    });
  });

  // Standard cameras steppers and input
  document.querySelectorAll('[data-target="standardCameras"]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const input = document.getElementById("standardCameras");
      if (!input) return;

      const current = parseInt(input.value, 10) || 0;
      if (btn.dataset.action === "increase") input.value = String(current + 1);
      if (btn.dataset.action === "decrease" && current > 0) input.value = String(current - 1);

      state.standardCameras = parseInt(input.value, 10) || 0;
      updateCamerasAndNodes();
    });
  });

  document.getElementById("standardCameras")?.addEventListener("input", (ev) => {
    const value = Math.max(0, parseInt(ev.target.value, 10) || 0);
    ev.target.value = String(value);
    state.standardCameras = value;
    updateCamerasAndNodes();
  });

  // Smart cameras steppers and input
  document.querySelectorAll('[data-target="smartCameras"]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const input = document.getElementById("smartCameras");
      if (!input) return;

      const current = parseInt(input.value, 10) || 0;
      if (btn.dataset.action === "increase") input.value = String(current + 1);
      if (btn.dataset.action === "decrease" && current > 0) input.value = String(current - 1);

      state.smartCameras = parseInt(input.value, 10) || 0;
      updateCamerasAndNodes();
    });
  });

  document.getElementById("smartCameras")?.addEventListener("input", (ev) => {
    const value = Math.max(0, parseInt(ev.target.value, 10) || 0);
    ev.target.value = String(value);
    state.smartCameras = value;
    updateCamerasAndNodes();
  });

  // Auto-add nodes toggle
  document.getElementById("autoAddNodes")?.addEventListener("change", (ev) => {
    state.autoAddNodes = ev.target.checked;
    updateCamerasAndNodes();
  });

  // Compute nodes steppers and input
  document.querySelectorAll('[data-target="computeNodes"]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (state.autoAddNodes) return;

      const input = document.getElementById("computeNodes");
      if (!input) return;

      const current = parseInt(input.value, 10) || 0;
      if (btn.dataset.action === "increase") input.value = String(current + 1);
      if (btn.dataset.action === "decrease" && current > 0) input.value = String(current - 1);

      state.computeNodes = parseInt(input.value, 10) || 0;
      updateCamerasAndNodes();
    });
  });

  document.getElementById("computeNodes")?.addEventListener("input", (ev) => {
    if (state.autoAddNodes) return;
    const value = Math.max(0, parseInt(ev.target.value, 10) || 0);
    ev.target.value = String(value);
    state.computeNodes = value;
    updateCamerasAndNodes();
  });

  // Step 2 → next: delegate to scenario-aware navigation (see body click handler above)
  onClick("continueStep2", () => {
    const totalCameras =
      (parseInt(document.getElementById("standardCameras")?.value, 10) || 0) +
      (parseInt(document.getElementById("smartCameras")?.value, 10) || 0);
    const totalNodes = parseInt(document.getElementById("computeNodes")?.value, 10) || 0;
    if (isScenarioC() && totalCameras === 0 && totalNodes === 0) {
      alert("Please enter at least one camera or one compute node for a new deployment.");
      return;
    }
    if (isScenarioC()) {
      goToScenarioStep(3);
    } else {
      goToScenarioStep(4);
    }
  });

  // Step 3 software checkboxes
  document.querySelectorAll('#step3 input[name="software"]').forEach((input) => {
    input.addEventListener("change", () => {
      updateSelectedSoftware();
      updateContinueStep3State();
    });
  });

  onClick("continueStep3", () => {
    // safeguard: don't advance if nothing selected
    updateSelectedSoftware();
    updateContinueStep3State();
    if (state.software.length === 0) return;
    goToScenarioStep(5);
  });

  // Current cost inputs
  document.getElementById("currentMonthly")?.addEventListener("input", (ev) => {
    state.currentMonthly = parseFloat(ev.target.value) || 0;
  });

  document.getElementById("currentUpfront")?.addEventListener("input", (ev) => {
    state.currentUpfront = parseFloat(ev.target.value) || 0;
  });

  document.querySelectorAll('input[name="frequency"]').forEach((input) => {
    input.addEventListener("change", (ev) => {
      const value = ev.target.value === "annual" ? "annual" : "monthly";
      state.frequency = value;

      // Update the Step 4 label so it matches the selected billing frequency
      const currentMonthlyLabel = document.querySelector('label[for="currentMonthly"]');
      if (currentMonthlyLabel) {
        currentMonthlyLabel.textContent =
          value === "annual" ? "Annual software cost" : "Monthly software cost";
      }

      // If results are visible, refresh comparison and savings so math follows the new frequency
      updateCostComparison();
      updateSavingsCard();
    });
  });

  onClick("continueStep4", () => goToStep(5));

  // Calculate
  onClick("calculateButton", () => runAnalysis());

  // Edit answers
  onClick("editAnswers", () => {
    resultsSection?.classList.remove("active");
    goToScenarioStep(1);
    calculatorSection?.scrollIntoView({ behavior: "smooth" });
  });

  // Start over
  onClick("startOver", () => window.location.reload());

  // Timeframe buttons
  document.querySelectorAll(".timeframe-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      document.querySelectorAll(".timeframe-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const months = parseInt(btn.dataset.months, 10) || 12;
      state.timeframe = months;

      updateCostComparison();
      updateSavingsCard();
    });
  });

  // Email PDF modal open/close
  onClick("emailPdfButton", () => {
    const modal = document.getElementById("emailModal");
    const summaryField = document.getElementById("hardwareEstimateSummary");
    const formWrapper = document.querySelector(".email-modal-form-wrapper");
    const thankYou = document.getElementById("emailThankYou");

    // Reset to form state whenever the modal is opened
    if (thankYou) {
      thankYou.classList.remove("active");
      thankYou.setAttribute("aria-hidden", "true");
    }
    if (formWrapper) {
      formWrapper.style.display = "";
    }

    if (summaryField) {
      summaryField.value = String(window.__HARDWARE_ESTIMATE_SUMMARY__ || "");
    }
    if (modal) {
      modal.classList.add("active");
      modal.setAttribute("aria-hidden", "false");
      
      // Scroll modal into view for iframe context
      setTimeout(() => {
        modal.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
    }
  });

  onClick("emailModalClose", () => {
    const modal = document.getElementById("emailModal");
    const modalHeader = document.getElementById("emailModalHeader");
    const formWrapper = document.querySelector(".email-modal-form-wrapper");
    const thankYou = document.getElementById("emailThankYou");
    if (thankYou) {
      thankYou.classList.remove("active");
      thankYou.setAttribute("aria-hidden", "true");
    }
    if (modalHeader) {
      modalHeader.style.display = "";
    }
    if (formWrapper) {
      formWrapper.style.display = "";
    }
    if (modal) {
      modal.classList.remove("active");
      modal.setAttribute("aria-hidden", "true");
    }
  });

  const emailModal = document.getElementById("emailModal");
  emailModal?.addEventListener("click", (e) => {
    if (e.target === emailModal) {
      const modalHeader = document.getElementById("emailModalHeader");
      const formWrapper = document.querySelector(".email-modal-form-wrapper");
      const thankYou = document.getElementById("emailThankYou");
      if (thankYou) {
        thankYou.classList.remove("active");
        thankYou.setAttribute("aria-hidden", "true");
      }
      if (modalHeader) {
        modalHeader.style.display = "";
      }
      if (formWrapper) {
        formWrapper.style.display = "";
      }
      emailModal.classList.remove("active");
      emailModal.setAttribute("aria-hidden", "true");
    }
  });

  // Custom HubSpot form submission from popup
  const emailForm = document.getElementById("emailEstimateForm");
  emailForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const formEl = e.currentTarget;
    const portalId = formEl.dataset.portalId;
    const formId = formEl.dataset.formId;

    const firstname = formEl.querySelector("#emailFirstName")?.value.trim() || "";
    const lastname = formEl.querySelector("#emailLastName")?.value.trim() || "";
    const email = formEl.querySelector("#emailAddress")?.value.trim() || "";
    const summary = formEl.querySelector("#hardwareEstimateSummary")?.value.trim() || "";

    const payload = {
      fields: [
        { name: "firstname", value: firstname },
        { name: "lastname", value: lastname },
        { name: "email", value: email },
        { name: "hardware_estimate_summary", value: summary },
      ],
      context: {
        pageUri: window.location.href,
        pageName: document.title,
      },
    };

    try {
      const resp = await fetch(
        `https://api.hsforms.com/submissions/v3/integration/submit/${portalId}/${formId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      if (resp.ok) {
        formEl.reset();
        const modal = document.getElementById("emailModal");
        const formWrapper = document.querySelector(".email-modal-form-wrapper");
        const thankYou = document.getElementById("emailThankYou");

        // Swap to thank-you state instead of alert
        const modalHeader = document.getElementById("emailModalHeader");
        if (modalHeader) {
          modalHeader.style.display = "none";
        }
        if (formWrapper) {
          formWrapper.style.display = "none";
        }
        if (thankYou) {
          thankYou.classList.add("active");
          thankYou.setAttribute("aria-hidden", "false");
        }

        if (modal) {
          modal.classList.add("active");
          modal.setAttribute("aria-hidden", "false");
        }
      } else {
        console.error("HubSpot form submission failed", await resp.text());
        alert("Something went wrong submitting the form. Please try again.");
      }
    } catch (err) {
      console.error("HubSpot form submission error", err);
      alert("Something went wrong submitting the form. Please try again.");
    }
  });

  // Thank-you close button inside modal
  onClick("emailThankYouClose", () => {
    const modal = document.getElementById("emailModal");
    const modalHeader = document.getElementById("emailModalHeader");
    const formWrapper = document.querySelector(".email-modal-form-wrapper");
    const thankYou = document.getElementById("emailThankYou");
    if (thankYou) {
      thankYou.classList.remove("active");
      thankYou.setAttribute("aria-hidden", "true");
    }
    if (modalHeader) {
      modalHeader.style.display = "";
    }
    if (formWrapper) {
      formWrapper.style.display = "";
    }
    if (modal) {
      modal.classList.remove("active");
      modal.setAttribute("aria-hidden", "true");
    }
  });
}

// Download PDF
onClick("downloadPdf", () => {
  generatePDF();
});

// ---------- CAMERA / NODE LOGIC ----------
function updateCamerasAndNodes() {
  const totalCameras = state.standardCameras + state.smartCameras;
  // Only standard IP cameras need compute nodes; smart cameras have built-in analytics
  const camerasNeedingNodes = state.standardCameras;
  const suggestedNodes =
    camerasNeedingNodes > 0 ? Math.ceil(camerasNeedingNodes / CAMERAS_PER_NODE) : 0;

  const totalDisplay = document.getElementById("totalCamerasDisplay");
  if (totalDisplay) totalDisplay.textContent = String(totalCameras);

  const computeNodesInput = document.getElementById("computeNodes");
  const nodeStepperButtons = document.querySelectorAll('[data-target="computeNodes"]');

  if (state.autoAddNodes && camerasNeedingNodes > 0) {
    state.computeNodes = suggestedNodes;

    if (computeNodesInput) {
      computeNodesInput.value = String(state.computeNodes);
      computeNodesInput.disabled = true;
      computeNodesInput.style.opacity = "0.6";
    }

    nodeStepperButtons.forEach((btn) => {
      btn.disabled = true;
      btn.style.opacity = "0.5";
      btn.style.cursor = "not-allowed";
    });
  } else {
    if (computeNodesInput) {
      computeNodesInput.disabled = false;
      computeNodesInput.style.opacity = "1";
    }

    nodeStepperButtons.forEach((btn) => {
      btn.disabled = false;
      btn.style.opacity = "1";
      btn.style.cursor = "pointer";
    });
  }

  updateNodeStatus(camerasNeedingNodes, suggestedNodes);

  // Show warning if user has Standard IP cameras but no nodes
  const nodeRequiredWarning = document.getElementById("nodeRequiredWarning");
  if (nodeRequiredWarning) {
    if (state.standardCameras > 0 && state.computeNodes === 0) {
      nodeRequiredWarning.style.display = "block";
    } else {
      nodeRequiredWarning.style.display = "none";
    }
  }
}

function updateNodeStatus(standardCameras, suggestedNodes) {
  const nodeStatus = document.getElementById("nodeStatus");
  if (!nodeStatus) return;

  const capacity = state.computeNodes * CAMERAS_PER_NODE;
  const requiredNodes = suggestedNodes;
  
  // Calculate potential savings by comparing nodes vs smart cameras
  const fmt = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  const nodesCost = state.computeNodes * PRICES.node;
  const smartCamerasCost = capacity * PRICES.smartCamera;
  const savings = smartCamerasCost - nodesCost;

  if (standardCameras === 0) {
    nodeStatus.className = "node-status neutral";
    nodeStatus.textContent =
      "Each compute node supports up to 4 Standard IP camera streams. Smart cameras have built-in analytics and do not require nodes.";
  } else if (state.computeNodes === 0) {
    nodeStatus.className = "node-status info";
    nodeStatus.textContent =
      `Each compute node supports up to 4 Standard IP camera streams. Your configuration requires ${requiredNodes} node${
        requiredNodes === 1 ? "" : "s"
      }. No nodes selected yet.`;
  } else if (capacity < standardCameras) {
    nodeStatus.className = "node-status warning";
    nodeStatus.textContent =
      `Each compute node supports up to 4 Standard IP camera streams. Your configuration requires ${requiredNodes} node${
        requiredNodes === 1 ? "" : "s"
      }, but selected nodes only support ${capacity} stream${capacity === 1 ? "" : "s"} for ${standardCameras} Standard IP camera${standardCameras === 1 ? "" : "s"}.`;
  } else {
    nodeStatus.className = "node-status success";
    const savingsText = savings > 0 ? ` This saves you ${fmt.format(savings)} compared to using ${capacity} Smart camera${capacity === 1 ? "" : "s"}.` : "";
    nodeStatus.textContent =
      `Each compute node supports up to 4 Standard IP camera streams. Your configuration requires ${requiredNodes} node${
        requiredNodes === 1 ? "" : "s"
      }. Selected nodes can support up to ${capacity} stream${capacity === 1 ? "" : "s"}.${savingsText}`;
  }
}

// ---------- STEP NAV ----------
// `goToStep` moves to a concrete DOM step id (step1, step2, ...).
// `goToScenarioStep` works in logical steps (1–5) and remaps for scenarios A/B.
function goToStep(step, logicalStepOverride) {
  console.log(`[savings] goToStep called with step=${step}, logical=${logicalStepOverride}`);
  document.querySelectorAll(".step").forEach((el) => el.classList.remove("active"));

  const stepId = `step${step}`;
  const stepElement = document.getElementById(stepId);
  if (stepElement) stepElement.classList.add("active");

  // Show/hide step instruction based on current step
  const stepInstruction = document.getElementById("step1Instruction");
  if (stepInstruction) {
    if (step === 1 || step === "1") {
      stepInstruction.classList.remove("hidden");
    } else {
      stepInstruction.classList.add("hidden");
    }
  }

  // Progress bar only tracks 1–5 (logical steps)
  const totalSteps = 5;
  const numericStep =
    logicalStepOverride != null
      ? logicalStepOverride
      : step === "1b"
      ? 1
      : (parseInt(step, 10) || 1);

  const progress = (numericStep / totalSteps) * 100;
  if (progressFill) progressFill.style.width = `${progress}%`;
  if (progressText) progressText.textContent = `Step ${numericStep} of ${totalSteps}`;

  state.step = step;
}

function goToScenarioStep(logicalStep) {
  // Reorder steps for scenarios A and B only:
  // A/B: 1 (step1) → 2 (step4) → 3 (step2) → 4 (step3) → 5 (step5)
  // C:   1 (step1) → 2 (step2) → 3 (step3) → 4 (step4) → 5 (step5)
  let domStep = logicalStep;
  if (isScenarioA() || isScenarioB()) {
    if (logicalStep === 2) domStep = 4;
    else if (logicalStep === 3) domStep = 2;
    else if (logicalStep === 4) domStep = 3;
    else domStep = logicalStep;
  }
  goToStep(domStep, logicalStep);
}

function selectOptionCard(btn) {
  const parent = btn.parentElement;
  if (!parent) return;
  parent.querySelectorAll(".option-card").forEach((el) => el.classList.remove("selected"));
  btn.classList.add("selected");
}

// ---------- SOFTWARE ----------
function updateSelectedSoftware() {
  const checked = document.querySelectorAll('#step3 input[name="software"]:checked');
  state.software = Array.from(checked).map((input) => ({
    type: input.value,
    price: parseFloat(input.dataset.price) || 0,
  }));
}

function updateContinueStep3State() {
  const btn = document.getElementById("continueStep3");
  if (!btn) return;
  btn.disabled = state.software.length === 0;
}

// ---------- ANALYSIS / RESULTS ----------
function runAnalysis() {
  const totalCameras = state.standardCameras + state.smartCameras;
  const monthlySoftwareTotal =
    state.software.reduce((sum, s) => sum + s.price, 0) * totalCameras;

  updateRecommendedSetup(monthlySoftwareTotal);
  updateCostComparison();
  updateSavingsCard();

  resultsSection?.classList.add("active");
  resultsSection?.scrollIntoView({ behavior: "smooth" });
}



function updateRecommendedSetup(monthlySoftwareTotal) {
  const container = document.getElementById("setupGrid");
  if (!container) return;

  const fmt = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  const totalCameras = state.standardCameras + state.smartCameras;
  const reuseStandard = isScenarioB();
  const rawHardwareStandard = state.standardCameras * PRICES.standardCamera;
  const hardwareStandard = reuseStandard ? 0 : rawHardwareStandard;
  const hardwareSmart = state.smartCameras * PRICES.smartCamera;
  const hardwareNodes = state.computeNodes * PRICES.node;
  const hardwareTotal = hardwareStandard + hardwareSmart + hardwareNodes;

  // Build simple line items
  let html = '<div class="breakdown-section">';
  html += '<div class="breakdown-title">Hardware</div>';
  
  if (state.standardCameras > 0) {
    html += `<div class="breakdown-row">`;
    html += reuseStandard
      ? `<span>Standard IP Cameras (${state.standardCameras})</span>`
      : `<span>Standard IP Cameras (${fmt.format(PRICES.standardCamera)} × ${state.standardCameras})</span>`;
    html += reuseStandard 
      ? `<span class="breakdown-value muted">Existing</span>`
      : `<span class="breakdown-value">${fmt.format(hardwareStandard)}</span>`;
    html += `</div>`;
  }
  
  if (state.smartCameras > 0) {
    html += `<div class="breakdown-row">`;
    html += `<span>Smart Cameras (${fmt.format(PRICES.smartCamera)} × ${state.smartCameras})</span>`;
    html += `<span class="breakdown-value">${fmt.format(hardwareSmart)}</span>`;
    html += `</div>`;
  }
  
  if (state.computeNodes > 0) {
    html += `<div class="breakdown-row">`;
    html += `<span>Compute Nodes (${fmt.format(PRICES.node)} × ${state.computeNodes})</span>`;
    html += `<span class="breakdown-value">${fmt.format(hardwareNodes)}</span>`;
    html += `</div>`;
  }
  
  if (state.standardCameras === 0 && state.smartCameras === 0 && state.computeNodes === 0) {
    html += `<div class="breakdown-row muted"><span>No hardware configured</span></div>`;
  }
  
  html += `<div class="breakdown-row breakdown-subtotal">`;
  html += `<span>Hardware Total</span>`;
  html += `<span class="breakdown-value">${fmt.format(hardwareTotal)}</span>`;
  html += `</div>`;
  html += '</div>';
  
  // Software section
  html += '<div class="breakdown-section">';
  html += '<div class="breakdown-title">Software (Monthly)</div>';
  
  if (totalCameras > 0 && state.software.length > 0) {
    state.software.forEach((s) => {
      const label = s.type === 'both' ? 'LPR + MMCG Bundle' : s.type.toUpperCase();
      html += `<div class="breakdown-row">`;
      html += `<span>${label} (${fmt.format(s.price)} × ${totalCameras} streams)</span>`;
      html += `<span class="breakdown-value">${fmt.format(s.price * totalCameras)}/mo</span>`;
      html += `</div>`;
    });
    html += `<div class="breakdown-row breakdown-subtotal">`;
    html += `<span>Software Total</span>`;
    html += `<span class="breakdown-value">${fmt.format(monthlySoftwareTotal)}/mo</span>`;
    html += `</div>`;
  } else if (totalCameras === 0) {
    html += `<div class="breakdown-row muted"><span>No cameras configured</span></div>`;
  } else {
    html += `<div class="breakdown-row muted"><span>No software selected</span><span class="breakdown-value">$0/mo</span></div>`;
  }
  html += '</div>';

  container.innerHTML = html;
}

function updateCostComparison() {
  const el = document.getElementById("costComparison");
  if (!el) return;

  const fmt = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  const totalCameras = state.standardCameras + state.smartCameras;
  const monthlySoftwareTotal =
    state.software.reduce((sum, s) => sum + s.price, 0) * totalCameras;

  const reuseStandard = isScenarioB();
  const rawHardwareStandard = state.standardCameras * PRICES.standardCamera;
  const hardwareStandard = reuseStandard ? 0 : rawHardwareStandard;
  const hardwareSmart = state.smartCameras * PRICES.smartCamera;
  const hardwareNodes = state.computeNodes * PRICES.node;
  const hardwareTotal = hardwareStandard + hardwareSmart + hardwareNodes;

  const sighthoundTotal = hardwareTotal + monthlySoftwareTotal * state.timeframe;

  const currentMonthlyNormalized =
    state.frequency === "annual" ? state.currentMonthly / 12 : state.currentMonthly;

  const currentTotal = state.currentUpfront + currentMonthlyNormalized * state.timeframe;

  let html = '';
  
  if (isScenarioC()) {
    // OPTION C — new deployment; no existing-cost comparison
    html += '<div class="comparison-column">';
    html += '<div class="comparison-title">Sighthound Deployment</div>';
    html += `<div class="breakdown-row"><span>Hardware (one-time)</span><span class="breakdown-value">${fmt.format(hardwareTotal)}</span></div>`;
    html += `<div class="breakdown-row"><span>Software (${state.timeframe} mo)</span><span class="breakdown-value">${fmt.format(monthlySoftwareTotal * state.timeframe)}</span></div>`;
    html += `<div class="breakdown-row breakdown-total"><span>Total</span><span class="breakdown-value">${fmt.format(sighthoundTotal)}</span></div>`;
    html += '</div>';
  } else {
    // Side-by-side comparison for A/B
    html += '<div class="comparison-column">';
    html += '<div class="comparison-title">Current Setup</div>';
    html += `<div class="breakdown-row"><span>Upfront</span><span class="breakdown-value">${fmt.format(state.currentUpfront)}</span></div>`;
    html += `<div class="breakdown-row"><span>Software (${state.timeframe} mo)</span><span class="breakdown-value">${fmt.format(currentMonthlyNormalized * state.timeframe)}</span></div>`;
    html += `<div class="breakdown-row breakdown-total"><span>Total</span><span class="breakdown-value">${fmt.format(currentTotal)}</span></div>`;
    html += '</div>';
    
    html += '<div class="comparison-column">';
    html += '<div class="comparison-title">Sighthound</div>';
    html += `<div class="breakdown-row"><span>Hardware (one-time)</span><span class="breakdown-value">${fmt.format(hardwareTotal)}</span></div>`;
    html += `<div class="breakdown-row"><span>Software (${state.timeframe} mo)</span><span class="breakdown-value">${fmt.format(monthlySoftwareTotal * state.timeframe)}</span></div>`;
    html += `<div class="breakdown-row breakdown-total"><span>Total</span><span class="breakdown-value">${fmt.format(sighthoundTotal)}</span></div>`;
    html += '</div>';
  }
  
  el.innerHTML = html;

  // Also surface a plain-text summary for the custom HubSpot popup form
  // Scenario-aware lead-in and context for the email summary
  let scenarioLead;
  if (isScenarioC()) {
    scenarioLead = `Deployment estimate over ${state.timeframe} months.`;
  } else if (isScenarioB()) {
    scenarioLead = `Upgrade estimate (reusing existing Standard IP cameras) over ${state.timeframe} months.`;
  } else if (isScenarioA()) {
    scenarioLead = `Replacement comparison over ${state.timeframe} months.`;
  } else {
    scenarioLead = `Cost comparison over ${state.timeframe} months.`;
  }

  let scenarioContext;
  if (isScenarioA()) {
    if (state.scenarioAOption === "smart") {
      scenarioContext = "Replacing your current smart / AI camera system with Sighthound Smart Cameras (built-in analytics).";
    } else {
      scenarioContext = "Replacing your current smart / AI camera system with Standard IP Cameras and Compute Nodes.";
    }
  } else if (isScenarioB()) {
    scenarioContext = "Assumes your existing Standard IP cameras remain in place and Sighthound provides nodes and analytics on top.";
  } else if (isScenarioC()) {
    scenarioContext = "All hardware and software are treated as new for this deployment.";
  } else {
    scenarioContext = "";
  }

  const summaryLines = [
    scenarioLead,
    scenarioContext,
    "",
    "HARDWARE:",
  ];

  // Hardware breakdown with unit pricing
  if (state.standardCameras > 0) {
    const unitPrice = fmt.format(PRICES.standardCamera);
    summaryLines.push(
      reuseStandard
        ? `  Standard IP Cameras (${state.standardCameras}) - Existing`
        : `  Standard IP Cameras (${unitPrice} × ${state.standardCameras}) - ${fmt.format(hardwareStandard)}`
    );
  }
  if (state.smartCameras > 0) {
    const unitPrice = fmt.format(PRICES.smartCamera);
    summaryLines.push(
      `  Smart Cameras (${unitPrice} × ${state.smartCameras}) - ${fmt.format(hardwareSmart)}`
    );
  }
  if (state.computeNodes > 0) {
    const unitPrice = fmt.format(PRICES.node);
    summaryLines.push(
      `  Compute Nodes (${unitPrice} × ${state.computeNodes}) - ${fmt.format(hardwareNodes)}`
    );
  }
  summaryLines.push(`  Hardware Total: ${fmt.format(hardwareTotal)}`);
  summaryLines.push("");
  summaryLines.push("SOFTWARE (MONTHLY):");

  // Software breakdown with unit pricing
  if (totalCameras > 0 && state.software.length > 0) {
    state.software.forEach((s) => {
      const label = s.type === 'both' ? 'LPR + MMCG Bundle' : s.type.toUpperCase();
      summaryLines.push(
        `  ${label} (${fmt.format(s.price)} × ${totalCameras} streams) - ${fmt.format(s.price * totalCameras)}/mo`
      );
    });
    summaryLines.push(`  Software Total: ${fmt.format(monthlySoftwareTotal)}/mo`);
  } else if (totalCameras === 0) {
    summaryLines.push("  No cameras configured");
  } else {
    summaryLines.push("  No software selected - $0/mo");
  }
  summaryLines.push("");

  // Cost comparison
  if (!isScenarioC()) {
    summaryLines.push(
      `CURRENT SETUP (${state.timeframe} months):`,
      `  Upfront: ${fmt.format(state.currentUpfront)}`,
      `  Software: ${fmt.format(currentMonthlyNormalized * state.timeframe)}`,
      `  Total: ${fmt.format(currentTotal)}`,
      ""
    );
  }

  summaryLines.push(
    `SIGHTHOUND (${state.timeframe} months):`,
    `  Hardware: ${fmt.format(hardwareTotal)}`,
    `  Software: ${fmt.format(monthlySoftwareTotal * state.timeframe)}`,
    `  Total: ${fmt.format(sighthoundTotal)}`,
  );

  const summary = summaryLines.filter(Boolean).join("\n");

  try {
    window.__HARDWARE_ESTIMATE_SUMMARY__ = summary;
  } catch (e) {
    // ignore if window is not available (e.g. during server-side rendering)
  }
}

function updateSavingsCard() {
  const el = document.getElementById("savingsCard");
  if (!el) return;

  const fmt = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  const totalCameras = state.standardCameras + state.smartCameras;
  const monthlySoftwareTotal =
    state.software.reduce((sum, s) => sum + s.price, 0) * totalCameras;

  const reuseStandard = isScenarioB();
  const rawHardwareStandard = state.standardCameras * PRICES.standardCamera;
  const hardwareStandard = reuseStandard ? 0 : rawHardwareStandard;
  const hardwareSmart = state.smartCameras * PRICES.smartCamera;
  const hardwareNodes = state.computeNodes * PRICES.node;
  const hardwareTotal = hardwareStandard + hardwareSmart + hardwareNodes;

  const sighthoundTotal = hardwareTotal + monthlySoftwareTotal * state.timeframe;

  const currentMonthlyNormalized =
    state.frequency === "annual" ? state.currentMonthly / 12 : state.currentMonthly;

  const currentTotal = state.currentUpfront + currentMonthlyNormalized * state.timeframe;

  const savings = currentTotal - sighthoundTotal;
  const savingsPerMonth = savings / (state.timeframe || 1);

  // OPTION A — Smart / AI cameras with built-in analytics
  // Savings language is allowed and must be labeled "Estimated savings".
  if (isScenarioA()) {
    const setupDesc = state.scenarioAOption === "smart"
      ? "Sighthound Smart Cameras with built-in analytics"
      : "Standard IP Cameras with Compute Nodes";
    if (savings > 0) {
      el.className = "savings-card";
      el.innerHTML =
        `<strong>Estimated replacement cost</strong><br>` +
        `Estimated savings of ${fmt.format(savings)} over ${state.timeframe} months ` +
        `(${fmt.format(savingsPerMonth)}/month compared to your current setup).`;
    } else {
      el.className = "savings-card neutral";
      el.innerHTML =
        `<strong>Estimated replacement cost</strong><br>` +
        `Additional investment of ${fmt.format(Math.abs(savings))} over ${state.timeframe} months. ` +
        `This reflects replacing your current system with ${setupDesc}.`;
    }
    return;
  }

  // OPTION B — Standard IP cameras (no advanced analytics)
  // Focus on capability enablement and upgrade cost (no implied savings language).
  if (isScenarioB()) {
    el.className = "savings-card neutral";
    el.innerHTML =
      `<strong>Estimated upgrade cost</strong><br>` +
      `${fmt.format(sighthoundTotal)} over ${state.timeframe} months to add centralized analytics ` +
      `on top of your existing Standard IP cameras.` +
      `<br><span class="savings-subcopy">Assumes your existing Standard IP cameras remain in place.</span>`;
    return;
  }

  // OPTION C — No cameras yet (new deployment)
  // No comparison or savings language; pure deployment cost.
  if (isScenarioC()) {
    el.className = "savings-card neutral";
    el.innerHTML =
      `<strong>Estimated deployment cost</strong><br>` +
      `${fmt.format(sighthoundTotal)} over ${state.timeframe} months for a new Sighthound deployment ` +
      `(hardware + optional analytics).`;
    return;
  }

  // Fallback (should be rare): treat as neutral comparison
  el.className = "savings-card neutral";
  el.textContent =
    `Estimated cost over ${state.timeframe} months: ${fmt.format(sighthoundTotal)}.`;
}

// ---------- PDF EXPORT ----------
async function generatePDF() {
  function findJsPDF() {
    if (window.jspdf && window.jspdf.jsPDF) return window.jspdf.jsPDF;
    if (window.jsPDF) return window.jsPDF;
    return null;
  }

  function loadJsPDF() {
    return new Promise((resolve, reject) => {
      const existing = findJsPDF();
      if (existing) return resolve(existing);

      const url = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      const s = document.createElement("script");
      s.src = url;
      s.async = true;
      s.onload = () => {
        const found = findJsPDF();
        if (found) return resolve(found);
        return reject(new Error("jsPDF loaded but global not found"));
      };
      s.onerror = (e) => reject(e || new Error("Failed to load jsPDF"));
      document.head.appendChild(s);
    });
  }

  // Helper: load logo image and convert to data URL for jsPDF
  function loadLogoAsDataUrl(src) {
    return new Promise((resolve, reject) => {
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          try {
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              return reject(new Error("canvas context not available"));
            }
            ctx.drawImage(img, 0, 0);
            const dataUrl = canvas.toDataURL("image/png");
            resolve(dataUrl);
          } catch (err) {
            reject(err);
          }
        };
        img.onerror = (err) => reject(err || new Error("Failed to load logo image"));
        img.src = src;
      } catch (e) {
        reject(e);
      }
    });
  }

  const jsPDFCtor = findJsPDF() || await loadJsPDF();
  const jsPDF = jsPDFCtor;
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;

  // Try to place Sighthound logo in the top-right corner of the page
  // This is best-effort only; if the image can't be loaded we silently skip it.
  try {
    const logoDataUrl = await loadLogoAsDataUrl("./assets/sighthound-logo-black.png");
    const logoWidth = 40; // mm
    const logoHeight = 10; // mm, approximate aspect ratio
    const logoX = pageWidth - margin - logoWidth;
    const logoY = margin - 6; // slightly above title
    doc.addImage(logoDataUrl, "PNG", logoX, logoY, logoWidth, logoHeight);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[savings] PDF logo not added", e);
  }

  let y = 20;

  const fmt = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  // Recompute numeric breakdowns (same logic used in UI)
  const totalCameras = state.standardCameras + state.smartCameras;
  const monthlySoftwareTotal =
    state.software.reduce((sum, s) => sum + s.price, 0) * totalCameras;
  const reuseStandard = isScenarioB();
  const rawHardwareStandard = state.standardCameras * PRICES.standardCamera;
  const hardwareStandard = reuseStandard ? 0 : rawHardwareStandard;
  const hardwareSmart = state.smartCameras * PRICES.smartCamera;
  const hardwareNodes = state.computeNodes * PRICES.node;
  const hardwareTotal = hardwareStandard + hardwareSmart + hardwareNodes;
  const sighthoundTotal = hardwareTotal + monthlySoftwareTotal * state.timeframe;
  const currentMonthlyNormalized =
    state.frequency === "annual" ? state.currentMonthly / 12 : state.currentMonthly;
  const currentTotal = state.currentUpfront + currentMonthlyNormalized * state.timeframe;
  const savings = currentTotal - sighthoundTotal;
  const savingsPerMonth = savings / (state.timeframe || 1);

  // Helpers for card-style layout
  function drawCard(title, lines, accentColor) {
    const cardPadding = 4;
    const innerWidth = contentWidth - cardPadding * 2;

    const wrappedLines = lines.flatMap((line) =>
      doc.splitTextToSize(line, innerWidth)
    );

    const lineHeight = 4.2;
    const minHeight = 16;
    const contentHeight = wrappedLines.length * lineHeight + 6;
    const cardHeight = Math.max(minHeight, contentHeight + cardPadding * 2);
    const x = margin;
    const top = y;

    // Card background & border
    doc.setDrawColor(230, 232, 240);
    doc.setFillColor(248, 249, 252);
    doc.roundedRect(x, top, contentWidth, cardHeight, 2, 2, "FD");

    // Accent bar on the left
    const [r, g, b] = accentColor;
    doc.setFillColor(r, g, b);
    doc.rect(x, top, 1.8, cardHeight, "F");

    // Title
    doc.setTextColor(17, 24, 39);
    doc.setFontSize(12);
    doc.text(title, x + cardPadding + 2, top + 6);

    // Body
    doc.setFontSize(10);
    doc.setTextColor(75, 85, 99);
    let textY = top + 11;
    wrappedLines.forEach((line) => {
      doc.text(line, x + cardPadding + 2, textY);
      textY += lineHeight;
    });

    y = top + cardHeight + 5;
  }

  // Title & subtitle (scenario-aware, respecting language guardrails)
  doc.setFontSize(18);
  doc.setTextColor(17, 24, 39);
  let pdfTitle = "Sighthound Savings Summary";
  if (isScenarioB()) pdfTitle = "Sighthound Upgrade Summary";
  if (isScenarioC()) pdfTitle = "Sighthound Deployment Estimate";
  doc.text(pdfTitle, margin, y);
  y += 8;

  doc.setFontSize(11);
  doc.setTextColor(107, 114, 128);
  const subtitleParts = [];
  if (totalCameras > 0) {
    subtitleParts.push(
      `${totalCameras} camera${totalCameras === 1 ? "" : "s"}`
    );
  }
  subtitleParts.push(`${state.timeframe} month analysis`);
  doc.text(subtitleParts.join(" • "), margin, y);
  y += 6;

  // Explicit scenario line for quick scanning in the PDF
  let scenarioLabel = "Custom scenario";
  if (isScenarioA()) {
    if (state.scenarioAOption === "smart") {
      scenarioLabel = "Replace with Sighthound Smart Cameras (built-in analytics)";
    } else {
      scenarioLabel = "Replace with Standard IP Cameras + Compute Nodes";
    }
  } else if (isScenarioB()) {
    scenarioLabel = "Reuse existing Standard IP cameras (upgrade)";
  } else if (isScenarioC()) {
    scenarioLabel = "New deployment (no existing cameras)";
  }
  doc.text(`Scenario: ${scenarioLabel}`, margin, y);
  y += 6;

  // Card 1: Primary framing (scenario-aware)
  if (isScenarioA()) {
    if (savings > 0) {
      drawCard(
        "Estimated savings",
        [
          `Estimated savings over ${state.timeframe} months: ${fmt.format(savings)}.`,
          `Average monthly impact: ${fmt.format(savingsPerMonth)} compared to today.`,
        ],
        [34, 197, 94] // bright green accent
      );
    } else if (savings < 0) {
      const pdfSetupDesc = state.scenarioAOption === "smart"
        ? "Sighthound Smart Cameras with built-in analytics"
        : "Standard IP Cameras with Compute Nodes";
      drawCard(
        "Estimated replacement cost",
        [
          `Additional investment over ${state.timeframe} months: ${fmt.format(Math.abs(savings))}.`,
          `Reflects replacing your current system with ${pdfSetupDesc}.`,
        ],
        [239, 68, 68] // red accent
      );
    } else {
      drawCard(
        "Neutral replacement comparison",
        [
          "Your projected Sighthound replacement costs are roughly in line with what you pay today.",
          "Adjust camera counts, analytics selection, or timeframe to explore different scenarios.",
        ],
        [107, 114, 128] // neutral gray accent
      );
    }
  } else if (isScenarioB()) {
    drawCard(
      "Upgrade cost overview",
      [
        `Estimated upgrade cost over ${state.timeframe} months: ${fmt.format(sighthoundTotal)}.`,
        "Represents adding centralized analytics on top of your existing Standard IP cameras.",
      ],
      [16, 185, 129]
    );
  } else if (isScenarioC()) {
    drawCard(
      "Deployment cost overview",
      [
        `Estimated deployment cost over ${state.timeframe} months: ${fmt.format(sighthoundTotal)}.`,
        "All hardware and software are treated as net-new in this scenario.",
      ],
      [79, 70, 229]
    );
  } else {
    drawCard(
      "Cost overview",
      [
        `Estimated cost over ${state.timeframe} months: ${fmt.format(sighthoundTotal)}.`,
      ],
      [107, 114, 128]
    );
  }

  // Card 2: Cost breakdown (mirrors on-screen calculator layout)
  const breakdownLines = [];
  breakdownLines.push("HARDWARE");

  // Hardware lines with unit pricing
  if (state.standardCameras > 0) {
    const unitPrice = fmt.format(PRICES.standardCamera);
    breakdownLines.push(
      reuseStandard
        ? `  Standard IP Cameras (${state.standardCameras}) - Existing`
        : `  Standard IP Cameras (${unitPrice} × ${state.standardCameras}) - ${fmt.format(hardwareStandard)}`
    );
  }
  if (state.smartCameras > 0) {
    const unitPrice = fmt.format(PRICES.smartCamera);
    breakdownLines.push(
      `  Smart Cameras (${unitPrice} × ${state.smartCameras}) - ${fmt.format(hardwareSmart)}`
    );
  }
  if (state.computeNodes > 0) {
    const unitPrice = fmt.format(PRICES.node);
    breakdownLines.push(
      `  Compute Nodes (${unitPrice} × ${state.computeNodes}) - ${fmt.format(hardwareNodes)}`
    );
  }

  breakdownLines.push(`  Hardware Total: ${fmt.format(hardwareTotal)}`);
  breakdownLines.push("");
  breakdownLines.push("SOFTWARE (MONTHLY)");

  // Software lines with unit pricing
  if (totalCameras > 0 && state.software.length > 0) {
    state.software.forEach((s) => {
      const label = s.type === 'both' ? 'LPR + MMCG Bundle' : s.type.toUpperCase();
      breakdownLines.push(
        `  ${label} (${fmt.format(s.price)} × ${totalCameras} streams) - ${fmt.format(s.price * totalCameras)}/mo`
      );
    });
    breakdownLines.push(`  Software Total: ${fmt.format(monthlySoftwareTotal)}/mo`);
  } else if (totalCameras === 0) {
    breakdownLines.push("  No cameras configured");
  } else {
    breakdownLines.push("  No software selected - $0/mo");
  }
  breakdownLines.push("");

  // Totals for the selected timeframe (scenario-aware)
  if (!isScenarioC()) {
    // Scenarios A & B — include current vs Sighthound comparison
    breakdownLines.push(
      `Current Setup — Upfront: ${fmt.format(state.currentUpfront)}, Monthly (${state.timeframe} mo): ${fmt.format(
        currentMonthlyNormalized * state.timeframe
      )}, Total: ${fmt.format(currentTotal)}`
    );
    breakdownLines.push(
      `Sighthound — Hardware: ${fmt.format(hardwareTotal)}, Monthly Software (${state.timeframe} mo): ${fmt.format(
        monthlySoftwareTotal * state.timeframe
      )}, Total: ${fmt.format(sighthoundTotal)}`
    );
  } else {
    // Scenario C — new deployment only, no current baseline
    breakdownLines.push(
      `Sighthound deployment — Hardware: ${fmt.format(hardwareTotal)}, Monthly Software (${state.timeframe} mo): ${fmt.format(
        monthlySoftwareTotal * state.timeframe
      )}, Total estimated deployment cost: ${fmt.format(sighthoundTotal)}`
    );
  }

  drawCard(
    isScenarioC() ? "Deployment cost breakdown" : "Cost breakdown",
    breakdownLines,
    [16, 185, 129]
  );

  // Card 3: Configuration snapshot
  let cameraTypeLabel = "Not specified";
  if (isScenarioA()) {
    cameraTypeLabel = state.scenarioAOption === "smart"
      ? "Sighthound Smart Cameras (replacement)"
      : "Standard IP + Compute Nodes (replacement)";
  } else if (isScenarioB()) {
    cameraTypeLabel = "IP cameras";
  } else if (isScenarioC()) {
    cameraTypeLabel = "New deployment";
  }

  drawCard(
    "Configuration snapshot",
    [
      `Scenario: ${cameraTypeLabel}`,
      `Standard IP cameras: ${state.standardCameras}`,
      `Smart cameras: ${state.smartCameras}`,
      `Compute nodes: ${state.computeNodes} (up to ${
        state.computeNodes * CAMERAS_PER_NODE || 0
      } cameras total capacity)`,
    ],
    [59, 130, 246]
  );

  // Card 4: What each component does
  drawCard(
    "What each component does",
    [
      "Standard IP cameras – traditional network cameras that provide general coverage across your site.",
      "Sighthound Smart cameras – AI-ready cameras with advanced on-device analytics for higher-value streams.",
      "Compute nodes – small servers that aggregate multiple camera feeds (up to 4 per node) and run Sighthound analytics.",
    ],
    [79, 70, 229]
  );

  // Use blob URL approach for better iframe and mobile compatibility
  const pdfBlob = doc.output('blob');
  const blobUrl = URL.createObjectURL(pdfBlob);
  
  // Check if we're in an iframe or on iOS (iOS doesn't support download attribute)
  const inIframe = window.self !== window.top;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  
  if (inIframe || isIOS) {
    // In iframe or iOS: open in new window/tab
    // iOS will show PDF in viewer where user can share/save
    const newWindow = window.open(blobUrl, '_blank');
    if (!newWindow) {
      // Popup blocked - fall back to navigating current window
      window.location.href = blobUrl;
    }
  } else {
    // Standard download approach for desktop browsers
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = 'savings-analysis.pdf';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
  
  // Clean up blob URL after a delay
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
}
