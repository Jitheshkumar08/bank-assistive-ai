# Graph Report - bank-ai  (2026-11-09)

## Corpus Check
- Large corpus: 826 files · ~1,279,954 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 6837 nodes · 19170 edges · 225 communities (168 shown, 57 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 1069 edges (avg confidence: 0.89)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- College Assistant Frontend Services
- College Assistant Engine Tests
- College Frontend i18n & Admission UI
- College Frontend Routing & Admin Tests
- Bank Frontend Voice Context Tests
- Language Engine HTTP Service
- College Admission & Fee Services
- College RAG Knowledge Retrieval
- College Admin Controllers & Auth
- College Admin Pages & Routes
- College Backend Prisma & Staff
- Bank Frontend Assistant Page Tests
- College Runtime Tests
- Phase 3.2B3 Dialogue Understanding
- College Frontend Auth Forms
- Voice Activity Recorder
- Domain Isolation & Registry
- College Frontend Session Shell
- Evaluation Harness
- College Auth Service
- College Session & API Errors
- College Admin Frontend Services
- Phase 3.2B4 Completion Semantics
- Phase 3.2B2 Turn Classification
- Bank Backend Users & Auth
- M10 Routing Safety Reports
- Bank Backend AI Engine Client
- Bank Frontend Assistant Types
- Dialogue Manager & Engine Core
- Voice Assistant Documentation
- College Workflow Loader
- College Backend App Modules
- Phase 3.2B1 Control Commands
- ASR Spike Research Docs
- College Frontend Home & UI Kit
- Bank Frontend Voice Composer
- Bank Backend Prisma & Admin
- Dialogue Response Generation
- IndicVoices ASR Benchmarks
- M5 Text Normalization
- Bank Frontend Microphone Hooks
- Proactive Assistance Tests
- College Super-Admin Staff
- Phase 3.2B1 Control Routing Tests
- Conversation Manager
- M4-M9 Evaluation Reports
- Phase 3.2B14 Workflow Tests
- Bank Backend Sessions Module
- Bank Backend Sessions Service
- M10 Intent Routing
- Bank Backend Assistant Controller
- M7 Knowledge Answering
- Bank Backend Branch Admin
- Admission Spreadsheet Import
- ASR & Translation Benchmarks
- M1 Indic Amount Extraction
- College Frontend Dev Dependencies
- ASR Candidate Smoke Tests
- ASR Evaluation Harness
- Speech Recognizer Abstraction
- Service TTS Tests
- College QR Codes Service
- Bank Frontend App Layout
- Domain Workflow Runner
- TTS Diagnostics Tests
- M3 Language Cues
- Domain Runtime Engine
- M6 Localization
- Session Registry Tests
- Phase 3.2B15 Term Normalization
- College Integration Tests
- Phase 3.2 Recording Detector Tests
- Remediation Tests
- Phase 2.5 Low-Confidence Intents
- Voice Assistant Pipeline
- Romanized Workflow Conflicts
- Service Turn Tests
- College Context Controller
- Bank Frontend Welcome Page
- Service Language Tests
- College Frontend QR Scanner
- M4 Intent Service Keywords
- Phase 3.1 Completion Contract
- Service Housekeeping Tests
- Bank Backend Runtime Dependencies
- Bank Frontend HTTP Client
- Speech Planning & TTS
- Audio Decoding Tests
- College Admin DTOs
- Workflow Snapshot Tests
- College Backend Dev Dependencies
- Cancel Confirmation Exit Tests
- LLM Cancel Confirmation
- Campus Map Collection
- Banking Audio Extraction
- Service Config Tests
- College Backend TS Config
- IndicConformer ASR Provider
- M8 Speech Tests
- Catalog Localizer
- Service TTS MP3 Joining
- CampusGuide READMEs & API
- Bank Frontend TS App Config
- Romanized Batch 1 Tests
- Routing Diagnosis
- M10 Routing Evaluator CLI
- IndicVoices Banking Selection
- Bank Backend NestJS Dependencies
- Bank Backend TS Config
- Bank Backend Dev Dependencies
- College Frontend Brand Visuals
- College Frontend TS App Config
- Speech-to-Text Routing
- College Frontend 3D Dependencies
- College Frontend TS Node Config
- Whisper Language Spike
- Phase 3.2B12 Banking Intents
- College Backend Type Dependencies
- College Admin Branch QR
- M10 Policy Tests
- College Backend Scripts
- Idle Session Reaper
- Bank Backend JWT & Roles
- Bank Frontend TS Node Config
- ASR Candidate Availability Spike
- Evaluation Harness Docs
- Bank Assistant Speak Endpoint
- College Frontend 3D Scene
- College Workflows & Backend Docs
- Bank Assistive AI README
- Control Command Audit
- College Backend Env Config
- Test Institute KB Fixtures
- Service TTS Speak Endpoint
- College Backend NestJS Core Deps
- Bank Backend Scripts
- College Frontend Test Dependencies
- Evaluation Engine Stub
- Deep Integration Audit
- Service Error Responses
- CampusGuide Admin UI Reference
- CampusGuide Student UI Reference
- College Frontend QR Dependencies
- Response Localizer
- Institution Campus Places
- College RAG Docs
- College Intents Runtime Docs
- Bank Frontend Dev Dependencies
- Bank Backend Env Validation
- ESLint Configuration
- Bank Backend Health Check
- Remediation Fallback Understanding
- Remediation Fake LLM Responses
- Service Config Module
- College Frontend Scripts
- Domain Resolution Docs
- Housekeeping Interval Config
- Bank Backend TS Build Config
- Vite & Vitest Config
- Knowledge Loader
- Baseline & M1-M3 Reports
- College Backend Nest CLI
- Bank Frontend Scripts
- Bank Frontend App Root
- Translator
- IVPQ Parquet Reader
- M1/M3 Auxiliary Reports
- Bank Backend Nest CLI
- Bank E2E Fake Engine
- Temp File Watch Helper
- Stub Understanding Client
- Offline Synthesis Helpers
- M10 Label Policy
- Session Entry
- Bank Backend Prisma Seed
- Login Throttle Guard
- Action Detector
- ASR Providers Docs
- College Backend Dotenv
- Campus Manifest
- Knowledge Manifest
- College Campus Fixture Manifest
- College KB Fixture Manifest
- Pre-M7 Answerer Stub
- Groq Recording Client
- Exploding Understanding Stub
- Backend Package Overrides
- College Frontend Vite Env Types
- College Frontend TS Root Config
- Bank Frontend Vite Env Types
- Bank Frontend TS Root Config
- Fake Chat Completions
- Housekeeping Fake Clock
- Platform Express v11
- Prisma v6
- Node Types v22
- Jest E2E Config
- Jest Unit Config
- Platform Express v12
- RxJS
- Nest CLI v12
- Prisma v7
- ts-jest
- tsx Runner
- Invalid Sample QR
- NMAMIT Admissions QR
- Frontend Node Engine
- Tailwind CSS
- Testing Library React
- Vite
- Vite React Plugin
- Vitest
- Project CLAUDE.md

## God Nodes (most connected - your core abstractions)
1. `WorkflowState` - 199 edges
2. `ConversationManager` - 109 edges
3. `useI18n()` - 90 edges
4. `DialogueManager` - 84 edges
5. `WorkflowLoader` - 84 edges
6. `AuthenticatedAccount` - 74 edges
7. `classify_command()` - 66 edges
8. `ApiError` - 63 edges
9. `VoiceAssistantPipeline` - 58 edges
10. `cn()` - 57 edges

## Surprising Connections (you probably didn't know these)
- `Bank Assistant Favicon (BrandMark tile)` --references--> `BrandMark()`  [EXTRACTED]
  bank-assistive-ai/frontend/public/favicon.svg → bank-assistive-ai/frontend/src/components/brand/BrandMark.tsx
- `HttpCollegeEngineClient` --semantically_similar_to--> `AiEngineClient abstraction`  [INFERRED] [semantically similar]
  bank-assistive-ai/docs/domain-integration/06-college-backend-integration.md → bank-assistive-ai/README.md
- `DomainKnowledgeRuntime` --references--> `register_domain_runtime registry`  [INFERRED]
  bank-assistive-ai/docs/domain-integration/04-college-intents-runtime.md → bank-assistive-ai/docs/domain-integration/02-domain-resolution.md
- `campus_map.py verified campus maps` --semantically_similar_to--> `Verified-only documents policy`  [INFERRED] [semantically similar]
  bank-assistive-ai/docs/domain-integration/05-college-workflows.md → bank-assistive-ai/docs/domain-integration/03-college-rag.md
- `Campus map verification procedure` --semantically_similar_to--> `Adding an official knowledge document`  [INFERRED] [semantically similar]
  bank-assistive-ai/language_engine/app/domains/college/campus/README.md → bank-assistive-ai/language_engine/app/domains/college/knowledge/README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **College evidence-only answer gates** — bank_assistive_ai_docs_domain_integration_03_college_rag_domainknowledgebase, bank_assistive_ai_docs_domain_integration_04_college_intents_runtime_category_narrowing, bank_assistive_ai_docs_domain_integration_03_college_rag_min_score_threshold, bank_assistive_ai_docs_domain_integration_04_college_intents_runtime_groundedanswerer, bank_assistive_ai_docs_domain_integration_03_college_rag_verified_only_policy [INFERRED 0.85]
- **College admission status round trip** — bank_assistive_ai_college_domain_backend_readme_assistant_messages_endpoint, bank_assistive_ai_docs_domain_integration_06_college_backend_integration_httpcollegeengineclient, bank_assistive_ai_docs_domain_integration_05_college_workflows_admission_status_workflow, bank_assistive_ai_docs_domain_integration_05_college_workflows_workflow_result_endpoint, bank_assistive_ai_docs_domain_integration_05_college_workflows_assistantadmissionstatusservice, bank_assistive_ai_college_domain_backend_readme_admission_details_endpoint, bank_assistive_ai_docs_domain_integration_06_college_backend_integration_studentcontext [EXTRACTED 1.00]
- **Deterministic routing tiers that run before IntentDetector** — bank_assistive_ai_language_engine_voice_assistant_documentation_tier1_deterministic_routing, bank_assistive_ai_language_engine_voice_assistant_documentation_acknowledgement_routing, bank_assistive_ai_language_engine_voice_assistant_documentation_polite_control, bank_assistive_ai_language_engine_voice_assistant_documentation_negation_protection, bank_assistive_ai_language_engine_voice_assistant_documentation_step_reference_routing, bank_assistive_ai_language_engine_voice_assistant_documentation_resting_state_control_guard [EXTRACTED 1.00]
- **Voice pipeline runtime flow** — bank_assistive_ai_language_engine_voice_assistant_documentation_audiorecorder, bank_assistive_ai_language_engine_voice_assistant_documentation_speechtotext, bank_assistive_ai_language_engine_voice_assistant_documentation_intentdetector, bank_assistive_ai_language_engine_voice_assistant_documentation_conversationmanager, bank_assistive_ai_language_engine_voice_assistant_documentation_dialoguemanager, bank_assistive_ai_language_engine_voice_assistant_documentation_dialogueunderstanding, bank_assistive_ai_language_engine_voice_assistant_documentation_knowledgeretriever, bank_assistive_ai_language_engine_voice_assistant_documentation_texttospeech [EXTRACTED 1.00]
- **Phase 2.5 general banking knowledge documents** — bank_assistive_ai_language_engine_app_knowledge_documents_cheque_book_cheque_book, bank_assistive_ai_language_engine_app_knowledge_documents_passbook_passbook, bank_assistive_ai_language_engine_app_knowledge_documents_savings_account_savings_account, bank_assistive_ai_language_engine_app_knowledge_documents_current_account_current_account, bank_assistive_ai_language_engine_app_knowledge_documents_account_number_account_number, bank_assistive_ai_language_engine_app_knowledge_documents_deposit_slip_deposit_slip, bank_assistive_ai_language_engine_app_knowledge_documents_withdrawal_slip_withdrawal_slip, bank_assistive_ai_language_engine_app_knowledge_documents_bank_transfer_bank_transfer, bank_assistive_ai_language_engine_app_knowledge_documents_banking_services_banking_services, bank_assistive_ai_language_engine_app_knowledge_documents_loan_basics_loan_basics, bank_assistive_ai_language_engine_app_knowledge_documents_account_opening_requirements_account_opening_requirements [EXTRACTED 1.00]
- **College workflow step kinds** — bank_assistive_ai_docs_domain_integration_05_college_workflows_domain_runner, bank_assistive_ai_docs_domain_integration_05_college_workflows_admission_guidance_workflow, bank_assistive_ai_docs_domain_integration_05_college_workflows_admission_status_workflow, bank_assistive_ai_docs_domain_integration_05_college_workflows_campus_navigation_workflow [EXTRACTED 1.00]
- **College KB multi-institute retrieval fixtures (distinct fixture codes per institute)** — bank_assistive_ai_language_engine_debugging_fixtures_college_kb_documents_test_institute_a_fees_alpha_fee, bank_assistive_ai_language_engine_debugging_fixtures_college_kb_documents_test_institute_b_fees_beta_fee, bank_assistive_ai_language_engine_debugging_fixtures_college_kb_documents_test_institute_a_hostel_alpha_hostel, bank_assistive_ai_language_engine_debugging_fixtures_college_kb_documents_test_institute_b_hostel_beta_hostel, bank_assistive_ai_language_engine_debugging_fixtures_college_kb_documents_test_institute_a_admission_documents_alpha_docs, bank_assistive_ai_language_engine_debugging_fixtures_college_kb_documents_test_institute_b_admission_documents_beta_docs [INFERRED 0.85]
- **Frozen banking ASR evaluation pipeline (schema, annotations, manifest, evaluator, baseline)** — bank_assistive_ai_language_engine_debugging_spike_banking_annotation_schema_schema_v1, bank_assistive_ai_language_engine_debugging_spike_banking_annotation_report_annotations, bank_assistive_ai_language_engine_debugging_spike_banking_annotation_report_banking_manifest, bank_assistive_ai_language_engine_debugging_spike_indicvoices_banking_asr_report_benchmark_indicvoices_banking_asr, bank_assistive_ai_language_engine_debugging_spike_indicvoices_banking_asr_report_banking_baseline [INFERRED 0.95]
- **Audited free Indian-language ASR candidates** — bank_assistive_ai_language_engine_debugging_spike_phase_3_2b10_asr_candidate_audit_sravaani, bank_assistive_ai_language_engine_debugging_spike_phase_3_2b10_asr_candidate_audit_indicconformer_600m, bank_assistive_ai_language_engine_debugging_spike_phase_3_2b10_asr_candidate_audit_indicconformer_onnx_sherpa, bank_assistive_ai_language_engine_debugging_spike_phase_3_2b10_asr_candidate_audit_vasista22_whisper, bank_assistive_ai_language_engine_debugging_spike_phase_3_2b10_asr_candidate_audit_mms, bank_assistive_ai_language_engine_debugging_spike_indicvoices_asr_report_whisper_small [EXTRACTED 1.00]
- **Evaluation harness milestone report series on multilingual_v1** — bank_assistive_ai_language_engine_evaluation_reports_baseline_m0_baseline_results, bank_assistive_ai_language_engine_evaluation_reports_m1_m1_results, bank_assistive_ai_language_engine_evaluation_reports_m3_m3_results, bank_assistive_ai_language_engine_evaluation_readme_multilingual_v1_fixtures [INFERRED 0.85]
- **Hands-free control-word safety risks** — bank_assistive_ai_language_engine_evaluation_reports_control_command_integration_audit_s1_incidental_destructive_cancel, bank_assistive_ai_language_engine_evaluation_reports_control_command_integration_audit_s2_band_karo_exit, bank_assistive_ai_language_engine_evaluation_reports_control_command_integration_audit_s3_no_words_cancel, bank_assistive_ai_language_engine_evaluation_reports_deep_language_engine_integration_audit_collisions_c1_c6, bank_assistive_ai_language_engine_evaluation_reports_control_command_integration_audit_voice_workflow_visit_domain_separation [INFERRED 0.75]
- **Production routing path steps** — bank_assistive_ai_language_engine_evaluation_reports_m10_diagnosis_normalize_turn, bank_assistive_ai_language_engine_evaluation_reports_m10_diagnosis_detect_control, bank_assistive_ai_language_engine_evaluation_reports_m10_diagnosis_answer_general_question_llm_gate, bank_assistive_ai_language_engine_evaluation_reports_m10_diagnosis_intent_detector_detect_intent, bank_assistive_ai_language_engine_evaluation_reports_m10_diagnosis_abstention_gate, bank_assistive_ai_language_engine_evaluation_reports_m10_diagnosis_refusal_gate, bank_assistive_ai_language_engine_evaluation_reports_m10_diagnosis_start_workflow [EXTRACTED 1.00]
- **M10 approved banking-policy decisions D1-D8** — bank_assistive_ai_language_engine_evaluation_reports_m10_policy_decisions_d1, bank_assistive_ai_language_engine_evaluation_reports_m10_policy_decisions_d2, bank_assistive_ai_language_engine_evaluation_reports_m10_policy_decisions_d3, bank_assistive_ai_language_engine_evaluation_reports_m10_policy_decisions_d4, bank_assistive_ai_language_engine_evaluation_reports_m10_policy_decisions_d5, bank_assistive_ai_language_engine_evaluation_reports_m10_policy_decisions_d6, bank_assistive_ai_language_engine_evaluation_reports_m10_policy_decisions_d7, bank_assistive_ai_language_engine_evaluation_reports_m10_policy_decisions_d8 [EXTRACTED 1.00]
- **M10 non-start routing outcomes** — bank_assistive_ai_language_engine_evaluation_reports_m10_report_ambiguous_service, bank_assistive_ai_language_engine_evaluation_reports_m10_report_unsupported_operation, bank_assistive_ai_language_engine_evaluation_reports_m10_report_knowledge_question, bank_assistive_ai_language_engine_evaluation_reports_m10_report_withheld_start [EXTRACTED 1.00]
- **M3 milestone before/after measurement** — bank_assistive_ai_language_engine_evaluation_reports_m3_targets_before_m3_targets_before_results, bank_assistive_ai_language_engine_evaluation_reports_m3_targets_after_m3_targets_after_results, bank_assistive_ai_language_engine_evaluation_reports_m3_m3_results, bank_assistive_ai_language_engine_evaluation_readme_refusal_gate [INFERRED 0.85]
- **multilingual_v1 Regression Reports (M4-M7)** — bank_assistive_ai_language_engine_evaluation_reports_m4, bank_assistive_ai_language_engine_evaluation_reports_m5, bank_assistive_ai_language_engine_evaluation_reports_m6, bank_assistive_ai_language_engine_evaluation_reports_m7, bank_assistive_ai_language_engine_evaluation_reports_m4_multilingual_v1_fixtures [EXTRACTED 1.00]
- **Before/After Fresh Fixture Evaluations** — bank_assistive_ai_language_engine_evaluation_reports_m4_heldout_before, bank_assistive_ai_language_engine_evaluation_reports_m4_heldout_after, bank_assistive_ai_language_engine_evaluation_reports_m5_fresh_before, bank_assistive_ai_language_engine_evaluation_reports_m5_fresh_after, bank_assistive_ai_language_engine_evaluation_reports_m7_fresh_before, bank_assistive_ai_language_engine_evaluation_reports_m7_fresh_after [INFERRED 0.85]
- **M9 ASR Evaluation Suite** — bank_assistive_ai_language_engine_evaluation_reports_m9_asr_baseline, bank_assistive_ai_language_engine_evaluation_reports_m9_smoke, bank_assistive_ai_language_engine_evaluation_reports_m9_forms_baseline, bank_assistive_ai_language_engine_evaluation_reports_m9_asr_baseline_indicconformer, bank_assistive_ai_language_engine_evaluation_reports_m9_asr_baseline_indicvoices_corpus [INFERRED 0.85]
- **College-domain QR sample fixtures (valid and invalid)** — bank_assistive_ai_college_domain_frontend_docs_qr_invalid_sample_png_image, bank_assistive_ai_college_domain_frontend_docs_qr_invalid_sample_svg_image, bank_assistive_ai_college_domain_frontend_docs_qr_nmamit_admissions_desk_png_image, bank_assistive_ai_college_domain_frontend_docs_qr_nmamit_admissions_desk_svg_image [INFERRED 0.85]
- **Admission Import Flow (upload, validate, log)** — bank_assistive_ai_college_domain_frontend_docs_reference_campusguide_admin_ui_reference_import_admissions, bank_assistive_ai_college_domain_frontend_docs_reference_campusguide_admin_ui_reference_import_results, bank_assistive_ai_college_domain_frontend_docs_reference_campusguide_admin_ui_reference_import_history, bank_assistive_ai_college_domain_frontend_docs_reference_campusguide_admin_ui_reference_import_wizard_steps [INFERRED 0.85]
- **CampusGuide QR verification flow (home -> scan -> result -> resources)** — bank_assistive_ai_college_domain_frontend_docs_reference_campusguide_ui_reference_student_home_page, bank_assistive_ai_college_domain_frontend_docs_reference_campusguide_ui_reference_qr_scanner_page, bank_assistive_ai_college_domain_frontend_docs_reference_campusguide_ui_reference_admission_result_dashboard, bank_assistive_ai_college_domain_frontend_docs_reference_campusguide_ui_reference_more_admission_resources [EXTRACTED 1.00]
- **CampusGuide public admission info pages (before QR)** — bank_assistive_ai_college_domain_frontend_docs_reference_campusguide_ui_reference_required_documents_page, bank_assistive_ai_college_domain_frontend_docs_reference_campusguide_ui_reference_admission_process_page, bank_assistive_ai_college_domain_frontend_docs_reference_campusguide_ui_reference_fee_structure_page [EXTRACTED 1.00]

## Communities (225 total, 57 thin omitted)

### Community 0 - "College Assistant Frontend Services"
Cohesion: 0.03
Nodes (98): defaultServices, ServicesContext, student, token, fromServer, renderCard(), Message, setup() (+90 more)

### Community 1 - "College Assistant Engine Tests"
Cohesion: 0.03
Nodes (56): ADMISSION_STATUS_ACTION, ADMISSION_STATUS_WORKFLOW, ASSISTANT_LANGUAGES, AssistantLanguage, AssistantReply, AssistantStudentContext, EngineAction, engineActionSchema (+48 more)

### Community 2 - "College Frontend i18n & Admission UI"
Cohesion: 0.04
Nodes (84): useCollegeContext(), AdmissionResultCard(), DetailFields(), FeeSection(), rupees(), View, viewForError(), AnnouncementPanel() (+76 more)

### Community 3 - "College Frontend Routing & Admin Tests"
Cohesion: 0.05
Nodes (78): adminApi, BRANCH_CODE_PATTERN, BranchDraft, BranchFieldErrors, BranchFields(), BranchFieldsProps, validateBranch(), CheckIcon() (+70 more)

### Community 4 - "Bank Frontend Voice Context Tests"
Cohesion: 0.04
Nodes (82): sessionsApi, ConversationContext, ConversationProvider(), ConversationState, DeliveredReply, isAbort(), messageId(), ReplyListener (+74 more)

### Community 5 - "Language Engine HTTP Service"
Cohesion: 0.04
Nodes (46): domain_ids(), test_concurrent_banking_and_college_turns_stay_apart(), run(), offer_assistance(), Caller, DomainUnavailable, ExpiredWorkflowAction, MismatchedWorkflowAction (+38 more)

### Community 6 - "College Admission & Fee Services"
Cohesion: 0.04
Nodes (46): AdmissionController, AdmissionDetailsDto, AdmissionDetailsQueryDto, AdmissionDetailsResponseDto, AdmissionResultDto, AdmissionResultResponseDto, AdmissionVerificationDto, CollegeQueryDto (+38 more)

### Community 7 - "College RAG Knowledge Retrieval"
Cohesion: 0.04
Nodes (34): CollectionDocument, KnowledgeCollection, DomainKnowledgeBase, InstitutionKnowledge, IsolationError, RetrievalOutcome, EmbeddingCache, text_key() (+26 more)

### Community 8 - "College Admin Controllers & Auth"
Cohesion: 0.06
Nodes (23): AdminController, AdmissionImportService, chunks(), csvCell(), present(), presentRow(), publicStatus(), statusLabel() (+15 more)

### Community 9 - "College Admin Pages & Routes"
Cohesion: 0.10
Nodes (80): useServices(), AdmissionStatusBadge(), Badge(), BadgeTone, Card(), Dialog(), EmptyState(), ErrorState() (+72 more)

### Community 10 - "College Backend Prisma & Staff"
Cohesion: 0.05
Nodes (48): @prisma/adapter-pg@^7.10.1, prisma, AuditService, AppConfig, deliverEmail(), DevOutboxEmailSender, InMemoryEmailSender, SmtpEmailSender (+40 more)

### Community 11 - "Bank Frontend Assistant Page Tests"
Cohesion: 0.04
Nodes (57): setup(), zxing, webgl, authApi, OFFER, AuthContext, AuthContextValue, active (+49 more)

### Community 12 - "College Runtime Tests"
Cohesion: 0.05
Nodes (53): build_prompt(), GroundedAnswerer, GeneratedText, banking_sentence(), _intent(), _fold_phrase(), IntentProfile, IntentSpec (+45 more)

### Community 13 - "Phase 3.2B3 Dialogue Understanding"
Cohesion: 0.07
Nodes (55): LLMActionDetector, accepts_recent_context(), extract_subject(), format_recent_context(), is_remembered_exchange(), next_context(), _normalize(), RecentSideQuestion (+47 more)

### Community 14 - "College Frontend Auth Forms"
Cohesion: 0.08
Nodes (62): confirmPassword, EmailOnlyInput, emailOnlySchema, EmailOnlyValues, newPassword, PASSWORD_MAX, PASSWORD_MIN, passwordLimits (+54 more)

### Community 15 - "Voice Activity Recorder"
Cohesion: 0.05
Nodes (31): AudioRecorder, load_vad_model(), RecorderError, _StreamOverflow, vad_load_count(), VadConfig, generator(), build_recorder() (+23 more)

### Community 16 - "Domain Isolation & Registry"
Cohesion: 0.05
Nodes (38): ContextPolicy, DomainConfig, KnowledgeConfig, NavigationConfig, get_domain(), UnknownDomainError, check(), raises() (+30 more)

### Community 17 - "College Frontend Session Shell"
Cohesion: 0.05
Nodes (58): framer-motion@^14.5.0, App(), AppProviders(), CollegeContextProvider(), CollegeContextValue, Ctx, readStored(), allowedReturnPath() (+50 more)

### Community 18 - "Evaluation Harness"
Cohesion: 0.05
Nodes (55): check(), FixedDetector, _fixture(), raises(), _route(), test_ambiguous_request_scoring(), test_amount_scoring(), test_command_choice_and_negation_scoring() (+47 more)

### Community 19 - "College Auth Service"
Cohesion: 0.05
Nodes (22): AuthController, alreadyRegisteredEmail(), passwordResetEmail(), verificationEmail(), AuthService, invalidCredentials(), EmailDto, LoginDto (+14 more)

### Community 20 - "College Session & API Errors"
Cohesion: 0.07
Nodes (31): listSelect, AuditInput, Db, describeAction(), descriptions, EventRow, presentAuditEvents(), authLimit (+23 more)

### Community 21 - "College Admin Frontend Services"
Cohesion: 0.05
Nodes (44): AdminService, get(), post(), qrCodeReader(), queryString(), AdminDashboard, AdmissionYearRow, AuditEntry (+36 more)

### Community 22 - "Phase 3.2B4 Completion Semantics"
Cohesion: 0.07
Nodes (53): classify_clause(), _completion_verb_positions(), _content_tokens(), _has_intention_marker(), _has_reporter(), _is_interrogative(), _is_request(), _negation_governs_completion() (+45 more)

### Community 23 - "Phase 3.2B2 Turn Classification"
Cohesion: 0.12
Nodes (53): classify_step_reference(), classify_turn(), normalize_command_text(), _resolve_step_token(), StepReference, strip_step_request_lead_ins(), cancelled_deposit(), check() (+45 more)

### Community 24 - "Bank Backend Users & Auth"
Cohesion: 0.06
Nodes (12): AuthController, AuthResult, AuthService, ChangePasswordDto, LoginDto, RegisterDto, UpdateProfileDto, PasswordService (+4 more)

### Community 25 - "M10 Routing Safety Reports"
Cohesion: 0.06
Nodes (61): M10 routing evaluation: m10_after_m0, M10 routing evaluator (m10_routing_eval.py), multilingual_v1.json fixture (M0), M10 routing evaluation: m10_after_m3, m3_language_cues.json fixture (M3), M10 routing evaluation: m10_after_m4, m4_heldout.json fixture (M4), M10 routing evaluation: m10_after_m5 (+53 more)

### Community 26 - "Bank Backend AI Engine Client"
Cohesion: 0.07
Nodes (35): ALLOWED_AUDIO_PREFIXES, AssistantReplyView, AssistantService, AssistantSnapshotView, extensionFor(), AiEngineClient, AiEngineError, EngineAssistance (+27 more)

### Community 27 - "Bank Frontend Assistant Types"
Cohesion: 0.06
Nodes (39): AssistanceCard(), AssistanceCardProps, FIELD_LABEL, taskName(), WorkflowProgress(), WorkflowProgressProps, MicrophoneStatus, ProactiveAssistance (+31 more)

### Community 28 - "Dialogue Manager & Engine Core"
Cohesion: 0.06
Nodes (15): SessionState, _default_client(), GroundedAnswer, numbers_in(), validate_answer(), _alternation(), _compile(), _parse() (+7 more)

### Community 29 - "Voice Assistant Documentation"
Cohesion: 0.06
Nodes (56): Account Number, Account Opening, General Account Opening Requirements, Initial Deposit, KYC (Know Your Customer), Bank Transfer, Beneficiary Details, Electronic Transfer Systems (NEFT, RTGS, IMPS, UPI) (+48 more)

### Community 30 - "College Workflow Loader"
Cohesion: 0.08
Nodes (34): UnknownOutcome, validate_definition(), WorkflowDefinitionError, WorkflowLoader, campus_fixtures(), check(), guide(), loader_outcomes() (+26 more)

### Community 31 - "College Backend App Modules"
Cohesion: 0.05
Nodes (24): AdminDashboardService, AdminModule, AdmissionModule, AppModule, AssistantModule, AuthModule, RolesGuard, { values } (+16 more)

### Community 32 - "Phase 3.2B1 Control Commands"
Cohesion: 0.10
Nodes (44): classify_command(), classify_polite_control(), contains_negation(), resolve_control_command(), strip_politeness(), check(), entities(), FakeUnderstanding (+36 more)

### Community 33 - "ASR Spike Research Docs"
Cohesion: 0.05
Nodes (55): Pilot category quotas (target 35 per language), Custom Banking Speech Recording Pilot (60-80 recordings, kn+hi), IndicVoices Banking Annotations (200 rows, first pass), indicvoices_banking_manifest.json (frozen, sha256 02a77306), Manual review rows (ivb_kn_001, ivb_kn_016, ivb_kn_072, ivb_hi_097), Rare safety fields: negation 3, control 1, completion 1 of 200, amount field (Indian numbering, rupees), completion_signal field (+47 more)

### Community 34 - "College Frontend Home & UI Kit"
Cohesion: 0.07
Nodes (51): College Domain Favicon, Bank Assistant Favicon (BrandMark tile), AccountToggle(), FORMS, AuthShell(), AuthShellProps, BrandMark(), BrandMarkProps (+43 more)

### Community 35 - "Bank Frontend Voice Composer"
Cohesion: 0.05
Nodes (42): ANNOUNCEMENT, Composer(), handleKeyDown(), handleSubmit(), submit(), ComposerProps, MIC_LABEL, MicIcon() (+34 more)

### Community 36 - "Bank Backend Prisma & Admin"
Cohesion: 0.08
Nodes (16): BRANCH_FIELDS, BranchesController, BranchesService, BranchSummary, Public(), AllExceptionsFilter, ErrorBody, HealthController (+8 more)

### Community 37 - "Dialogue Response Generation"
Cohesion: 0.06
Nodes (4): coerce_step_number(), DialogueUnderstanding, DialogueManager, restate_current_step()

### Community 38 - "IndicVoices ASR Benchmarks"
Cohesion: 0.08
Nodes (45): normalise_for_scoring(), aggregate(), analyse(), bootstrap_ci(), category_summary(), _cell(), contains_seq(), cpu_name() (+37 more)

### Community 39 - "M5 Text Normalization"
Cohesion: 0.07
Nodes (34): contains_indic_negation(), is_negating_word(), classify_by_stem(), merge_phrase_sets(), _nfc_table(), strip_trailing_fragments(), _canonical_word(), canonicalize_loanwords() (+26 more)

### Community 40 - "Bank Frontend Microphone Hooks"
Cohesion: 0.06
Nodes (34): describeFailure(), Failure, Microphone, MIME_CANDIDATES, RecordingEnd, selectMimeType(), FakeMediaRecorder, renderWith() (+26 more)

### Community 41 - "Proactive Assistance Tests"
Cohesion: 0.09
Nodes (35): choose_prompt(), field_help(), step_field(), WorkflowConflict, Api, check(), forbidden_runtime(), instruction() (+27 more)

### Community 42 - "College Super-Admin Staff"
Cohesion: 0.07
Nodes (7): StaffActivationController, AcceptInvitationDto, AccessChangeDto, AuditQueryDto, InvitationTokenDto, InviteCollegeAdminDto, SuperAdminController

### Community 43 - "Phase 3.2B1 Control Routing Tests"
Cohesion: 0.13
Nodes (31): looks_like_a_control_utterance(), cancelled_deposit(), check(), completed_deposit(), entities(), FakeUnderstanding, fresh_conversation(), main() (+23 more)

### Community 44 - "Conversation Manager"
Cohesion: 0.07
Nodes (14): ConversationManager, active_workflow(), check(), FailingUnderstanding, main(), make_dialogue(), section(), test_attribute_error_path() (+6 more)

### Community 45 - "M4-M9 Evaluation Reports"
Cohesion: 0.06
Nodes (49): M4 Multilingual Evaluation Report, baseline_m0 Comparison Baseline, Control Tier / Prefilters, evaluation.harness (offline multilingual eval), M4 Held-out Evaluation (after), M4 Held-out Evaluation (before), Ambiguous Request Guessed-Service Failure, m4_heldout Fixture Set (57 fixtures) (+41 more)

### Community 46 - "Phase 3.2B14 Workflow Tests"
Cohesion: 0.17
Nodes (32): PausedWorkflow, same_workflow(), active_workflow(), check(), entities(), FakeUnderstanding, LegacyDetector, main() (+24 more)

### Community 47 - "Bank Backend Sessions Module"
Cohesion: 0.06
Nodes (22): AppModule, AssistantModule, EngineModule, AuthModule, JwtAuthGuard, BranchesModule, IS_PUBLIC_KEY, ThrottlerBehindProxyGuard (+14 more)

### Community 48 - "Bank Backend Sessions Service"
Cohesion: 0.07
Nodes (10): ContextController, ContextService, ResolvedContext, ResolveContextDto, CreateSessionDto, SessionsController, SESSION_VIEW, SessionsService (+2 more)

### Community 49 - "M10 Intent Routing"
Cohesion: 0.08
Nodes (27): IntentDetector, all_anchor_examples(), all_banking_examples(), declined_regardless_cues(), information_question_cues(), troubleshooting_cues(), unsupported_operation_cues(), _words() (+19 more)

### Community 50 - "Bank Backend Assistant Controller"
Cohesion: 0.07
Nodes (11): AssistantController, UploadedAudio, AssistanceDto, SendMessageDto, SendVoiceDto, SpeakDto, CurrentUser, client() (+3 more)

### Community 51 - "M7 Knowledge Answering"
Cohesion: 0.08
Nodes (32): answer_language(), answer_language_rules(), answer_language_system_note(), language_rules(), mark_generated(), strip_instruction(), knowledge_terms(), retrieval_queries() (+24 more)

### Community 52 - "Bank Backend Branch Admin"
Cohesion: 0.07
Nodes (8): AdminController, AdminModule, AdminBranch, AdminOverview, AdminService, CreateBranchDto, UpdateBranchDto, Roles()

### Community 53 - "Admission Spreadsheet Import"
Cohesion: 0.07
Nodes (41): exceljs@^4.4.0, BatchRow, batchSelect, branchCode(), ColumnInfo, RowFilter, rowFilters, StoredRow (+33 more)

### Community 54 - "ASR & Translation Benchmarks"
Cohesion: 0.08
Nodes (29): audio_path_for(), available(), code_mixed_report(), entity_report(), error_rate(), evaluate_entities(), evaluate_intent(), evaluate_must_contain() (+21 more)

### Community 55 - "M1 Indic Amount Extraction"
Cohesion: 0.07
Nodes (27): _build_lexicon(), _extract(), extract_amount(), _kannada_compounds(), _kannada_fractions(), _oblique_hundreds(), parse_amount(), _phrases() (+19 more)

### Community 56 - "College Frontend Dev Dependencies"
Cohesion: 0.07
Nodes (43): devDependencies, eslint@^10.13.0, @eslint/js@^10.0.1, globals@^17.13.0, jsdom@^30.1.3, qrcode@^1.5.4, @testing-library/dom@^10.4.2, @testing-library/jest-dom@^7.0.1 (+35 more)

### Community 57 - "ASR Candidate Smoke Tests"
Cohesion: 0.09
Nodes (24): main(), script_share(), main(), script_share(), levenshtein(), main(), normalise_for_scoring(), script_share() (+16 more)

### Community 58 - "ASR Evaluation Harness"
Cohesion: 0.10
Nodes (30): align_counts(), check(), clip(), engine(), test_amount_effects(), test_asr_errors_are_counted(), test_clip_inventory(), test_forms_fixture_is_valid_and_frozen() (+22 more)

### Community 59 - "Speech Recognizer Abstraction"
Cohesion: 0.08
Nodes (8): SpeechRecognitionResult, SpeechRecognizer, build_providers(), create_recognizer(), _parse_map(), WhisperRecognizer, FakeWhisper, FakeRecognizer

### Community 60 - "Service TTS Tests"
Cohesion: 0.12
Nodes (27): check(), generator_writing(), passthrough(), run(), test_accepts_a_normal_reply(), test_deletes_the_temporary_file(), test_deletes_the_temporary_file_after_failure(), test_detects_the_real_format() (+19 more)

### Community 61 - "College QR Codes Service"
Cohesion: 0.10
Nodes (10): CollegeAdminQrCodesController, sendImage(), SuperAdminQrCodesController, QrCodesService, contentTypes, options, QrImageFormat, renderQr() (+2 more)

### Community 62 - "Bank Frontend App Layout"
Cohesion: 0.09
Nodes (27): BranchBadge(), BranchBadgeProps, AccountMenu(), AccountMenuProps, Avatar(), initials(), SettingsIcon(), SignOutIcon() (+19 more)

### Community 63 - "Domain Workflow Runner"
Cohesion: 0.11
Nodes (5): compose_parts(), RenderedText, DomainWorkflowRunner, _place(), StepReply

### Community 64 - "TTS Diagnostics Tests"
Cohesion: 0.12
Nodes (24): sanitize_for_speech(), Captured, check(), Endpoint, offline(), no_secrets(), raises(), safe_body() (+16 more)

### Community 65 - "M3 Language Cues"
Cohesion: 0.09
Nodes (28): looks_like_a_question(), asks_for_own_balance(), looks_like_an_indic_question(), question_cues(), active_deposit(), check(), FixedDetector, _Host (+20 more)

### Community 66 - "Domain Runtime Engine"
Cohesion: 0.08
Nodes (7): FakeBanking, FakeRuntime, _Decision, DomainKnowledgeRuntime, _from_step(), EngineRuntime, TurnResult

### Community 67 - "M6 Localization"
Cohesion: 0.10
Nodes (26): compose(), ComposedReply, localize(), localize_detailed(), cancel_confirmation_question(), display_name(), check(), devanagari() (+18 more)

### Community 68 - "Session Registry Tests"
Cohesion: 0.13
Nodes (20): test_same_session_id_in_two_domains_is_two_sessions(), test_session_is_bound_to_its_institution(), check(), test_a_new_conversation_starts_ready(), test_a_returning_session_keeps_its_state(), test_concurrent_creation_is_safe(), worker(), test_concurrent_distinct_sessions_are_safe() (+12 more)

### Community 69 - "Phase 3.2B15 Term Normalization"
Cohesion: 0.15
Nodes (24): _compile_patterns(), normalize_banking_terms(), audit_active_workflow(), audit_architecture(), audit_control_and_ood(), audit_english(), audit_hindi(), audit_kannada() (+16 more)

### Community 70 - "College Integration Tests"
Cohesion: 0.11
Nodes (20): action_ttl_from_env(), ActionExpired, ActionTypeMismatch, NoPendingAction, check(), Clock, _post_result(), raises() (+12 more)

### Community 71 - "Phase 3.2 Recording Detector Tests"
Cohesion: 0.18
Nodes (24): check(), entities(), FakeUnderstanding, fresh_conversation(), last_assistant(), main(), make_dialogue(), make_pipeline() (+16 more)

### Community 72 - "Remediation Tests"
Cohesion: 0.15
Nodes (24): bare_understanding(), check(), EmptyRetriever, FakeUnderstanding, fresh_conversation(), main(), make_dialogue(), RaisingClient (+16 more)

### Community 73 - "Phase 2.5 Low-Confidence Intents"
Cohesion: 0.13
Nodes (16): check(), main(), RecordingUnderstanding, section(), started_deposit_at_step_2(), test_completion_still_advances(), test_current_step_question(), test_exit_regression() (+8 more)

### Community 74 - "Voice Assistant Pipeline"
Cohesion: 0.10
Nodes (14): main(), print_header(), _accepts_keyword(), VoiceAssistantPipeline, test_d7_the_routing_layer_answers_a_complaint_not_a_refusal(), __init__(), _Host, StandInDetector (+6 more)

### Community 75 - "Romanized Workflow Conflicts"
Cohesion: 0.12
Nodes (18): cancel_confirmation(), conflict_question(), resolve_conflict_answer(), _tokens(), check(), section(), test_exit_and_batch1_unchanged(), test_g3_active_asks_then_confirms() (+10 more)

### Community 76 - "Service Turn Tests"
Cohesion: 0.19
Nodes (22): test_history_keeps_what_was_said(), active_workflow(), assistant_history(), check(), conflict_case(), entities(), FakeUnderstanding, fresh_conversation() (+14 more)

### Community 77 - "College Context Controller"
Cohesion: 0.08
Nodes (13): CollegeContextDto, ContextController, QrPayloadDto, AREA_PATTERN, buildQrPayload(), buildScanLink(), CollegeContext, ID_PATTERN (+5 more)

### Community 78 - "Bank Frontend Welcome Page"
Cohesion: 0.13
Nodes (24): MessageBubble(), MessageBubbleProps, MessageList(), MessageListProps, RequestIcon(), useOptionalVoice(), COMMON_REQUESTS, CommonRequest (+16 more)

### Community 79 - "Service Language Tests"
Cohesion: 0.14
Nodes (21): check(), Harness, put_in_deposit_step_two(), snapshot(), test_a_running_turn_never_changes_language_halfway(), long_turn(), switching_turn(), test_asr_localizer_and_voice_agree() (+13 more)

### Community 80 - "College Frontend QR Scanner"
Cohesion: 0.10
Nodes (22): AimingFrame(), ANNOUNCEMENT, CameraOffIcon(), CameraProblem(), CHIP, CORNERS, isFailure(), QrScanner() (+14 more)

### Community 81 - "M4 Intent Service Keywords"
Cohesion: 0.14
Nodes (22): _asks_about_money_held(), _bigram(), service_evidence(), all_fixtures(), check(), detector(), _key(), _scripts() (+14 more)

### Community 82 - "Phase 3.1 Completion Contract"
Cohesion: 0.13
Nodes (16): check(), deposit_at_step_2(), deposit_at_step_3(), entities(), FakeUnderstanding, fresh_conversation(), main(), make_dialogue() (+8 more)

### Community 83 - "Service Housekeeping Tests"
Cohesion: 0.16
Nodes (27): check(), fresh_conversation(), registry_with_clock(), test_a_conversation_mid_turn_is_never_purged(), test_a_slow_turn_does_not_count_as_idle_time(), test_a_turn_resets_the_idle_clock(), test_active_workflows_report_their_real_total(), test_default_idle_timeout_is_unchanged() (+19 more)

### Community 84 - "Bank Backend Runtime Dependencies"
Cohesion: 0.07
Nodes (30): dependencies, argon2@^0.45.1, class-transformer@^0.5.1, class-validator@^0.15.1, cookie-parser@^1.4.7, helmet@^8.3.0, @nestjs/common@^12.2.0, @nestjs/config@^12.0.1 (+22 more)

### Community 85 - "Bank Frontend HTTP Client"
Cohesion: 0.11
Nodes (18): api, BASE_URL, onUnauthorized(), readToken(), request(), requestBlob(), RequestOptions, setTokenReader() (+10 more)

### Community 86 - "Speech Planning & TTS"
Cohesion: 0.11
Nodes (9): normalise_language(), plan_speech(), sentence_language(), SpeechSegment, UnsupportedScriptError, UnsupportedSpeechLanguageError, TextToSpeech, test_refusals() (+1 more)

### Community 87 - "Audio Decoding Tests"
Cohesion: 0.15
Nodes (15): check(), FakeModel, Indic, router(), skip(), test_inference_failure_still_falls_back(), test_invalid_audio_is_refused(), test_temporary_files_are_cleaned_up() (+7 more)

### Community 88 - "College Admin DTOs"
Cohesion: 0.17
Nodes (8): ImportCommitDto, ImportListQueryDto, ImportPreviewDto, ImportRowsQueryDto, PageQueryDto, ReportQueryDto, StudentRecordQueryDto, UpdateStudentRecordDto

### Community 89 - "Workflow Snapshot Tests"
Cohesion: 0.16
Nodes (16): Api, check(), forbidden_runtime(), RuntimeForbidden, section(), state_of(), test_active_workflow(), test_exited_session() (+8 more)

### Community 90 - "College Backend Dev Dependencies"
Cohesion: 0.07
Nodes (27): devDependencies, eslint@^10.13.0, @eslint/js@^10.0.1, globals@^17.13.0, jest@^30.5.2, @nestjs/schematics@^12.0.10, supertest@^7.3.1, @types/cookie-parser@^1.4.10 (+19 more)

### Community 91 - "Cancel Confirmation Exit Tests"
Cohesion: 0.19
Nodes (17): check(), Harness, section(), test_a_new_workflow_clears_a_pending_question(), test_audio_after_exit_is_not_transcribed(), test_band_karo_unchanged(), test_confirmation(), test_exit_then_more_turns() (+9 more)

### Community 92 - "LLM Cancel Confirmation"
Cohesion: 0.18
Nodes (14): is_cancel_confirmation(), check(), outcome_with(), section(), test_explicit_confirmation_cancels(), test_llm_cancel_only_asks(), test_mislabelled_refusal_cannot_cancel(), test_normal_progress_is_unchanged() (+6 more)

### Community 93 - "Campus Map Collection"
Cohesion: 0.11
Nodes (6): ManifestError, CampusMapCollection, CampusPlace, CampusRoute, test_campus_map_validation(), load()

### Community 94 - "Banking Audio Extraction"
Cohesion: 0.14
Nodes (11): decode_levels(), fail(), handle_clip(), page_plan(), process_page(), run_file(), streaminfo(), values_in_page() (+3 more)

### Community 95 - "Service Config Tests"
Cohesion: 0.22
Nodes (19): check(), main(), test_a_missing_file_is_not_an_error(), test_a_real_environment_variable_wins(), test_an_empty_placeholder_changes_nothing(), test_applies_values_to_the_environment(), test_describe_never_leaks_a_value(), test_drops_a_trailing_comment_only_when_unquoted() (+11 more)

### Community 96 - "College Backend TS Config"
Cohesion: 0.08
Nodes (24): compilerOptions, emitDecoratorMetadata, esModuleInterop, experimentalDecorators, forceConsistentCasingInFileNames, incremental, lib, module (+16 more)

### Community 97 - "IndicConformer ASR Provider"
Cohesion: 0.13
Nodes (7): AudioDecodeError, decode_with_ffmpeg(), IndicConformerRecognizer, is_wav(), _models_from_env(), read_waveform(), read_wav()

### Community 98 - "M8 Speech Tests"
Cohesion: 0.18
Nodes (20): script_of(), word_script(), check(), plan(), recording(), synth(), test_a_failed_part_returns_no_audio(), test_cli_follows_the_same_policy() (+12 more)

### Community 99 - "Catalog Localizer"
Cohesion: 0.11
Nodes (5): catalog_localizer_factory(), make(), CatalogLocalizer, _CompiledCatalog, SentenceCatalog

### Community 100 - "Service TTS MP3 Joining"
Cohesion: 0.10
Nodes (9): test_mp3_joining(), _describe_exception(), _edge_tts_generator(), _id3v2_length(), _identify_audio(), is_recognised_audio(), join_mp3(), _log() (+1 more)

### Community 101 - "CampusGuide READMEs & API"
Cohesion: 0.11
Nodes (21): CampusGuide Backend README, Super Admin bootstrap command, GET /students/me/admission-details, Admission imports (preview/commit), AdmissionRecord model, POST /api/assistant/messages, AuditEvent append-only log, CampusGuide NestJS backend (+13 more)

### Community 102 - "Bank Frontend TS App Config"
Cohesion: 0.09
Nodes (22): compilerOptions, allowImportingTsExtensions, baseUrl, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+14 more)

### Community 103 - "Romanized Batch 1 Tests"
Cohesion: 0.25
Nodes (16): WorkflowState, check(), section(), test_excluded_phrases_unchanged(), test_new_pause_phrases(), test_new_phrases_answer_no_pending_question(), test_new_repeat_phrases(), test_next_during_an_active_workflow() (+8 more)

### Community 104 - "Routing Diagnosis"
Cohesion: 0.15
Nodes (14): assistant_label(), cause(), correct(), diagnose_banking(), diagnose_forms(), diagnose_general(), load_inputs(), m9_label() (+6 more)

### Community 105 - "M10 Routing Evaluator CLI"
Cohesion: 0.13
Nodes (11): main(), _after_gate(), decide(), evaluate(), _expect_from_harness(), main(), rate(), render() (+3 more)

### Community 106 - "IndicVoices Banking Selection"
Cohesion: 0.16
Nodes (9): eligible(), fail(), fetch(), main(), select(), sha256_file(), sha256_json(), write_json() (+1 more)

### Community 107 - "Bank Backend NestJS Dependencies"
Cohesion: 0.09
Nodes (22): dependencies, class-transformer@^0.5.1, class-validator@^0.14.1, @nestjs/common@^11.0.0, @nestjs/config@^4.0.0, @nestjs/jwt@^12.0.1, @nestjs/passport@^12.0.0, @nestjs/throttler@^6.5.0 (+14 more)

### Community 108 - "Bank Backend TS Config"
Cohesion: 0.09
Nodes (21): compilerOptions, allowSyntheticDefaultImports, baseUrl, declaration, emitDecoratorMetadata, esModuleInterop, experimentalDecorators, forceConsistentCasingInFileNames (+13 more)

### Community 109 - "Bank Backend Dev Dependencies"
Cohesion: 0.10
Nodes (21): devDependencies, jest@^30.5.1, @nestjs/cli@^11.0.0, @nestjs/testing@^11.2.3, supertest@^7.2.2, ts-jest@^29.4.12, @types/express@^5.0.0, @types/jest@^30.0.0 (+13 more)

### Community 110 - "College Frontend Brand Visuals"
Cohesion: 0.19
Nodes (11): BrandPanel(), BrandMark(), CampusIllustration(), CampusVisual(), ThreeDScene, Props, SceneErrorBoundary, State (+3 more)

### Community 111 - "College Frontend TS App Config"
Cohesion: 0.10
Nodes (20): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection, moduleResolution (+12 more)

### Community 112 - "Speech-to-Text Routing"
Cohesion: 0.13
Nodes (3): RoutingSpeechRecognizer, SpeechToText, ScriptedRuntime

### Community 113 - "College Frontend 3D Dependencies"
Cohesion: 0.10
Nodes (20): dependencies, @fontsource-variable/fraunces@^5.3.0, @fontsource-variable/inter@^5.3.0, @hookform/resolvers@^5.9.2, lucide-react@^1.61.0, react@^19.3.1, react-dom@^19.3.1, react-hook-form@^7.90.0 (+12 more)

### Community 114 - "College Frontend TS Node Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, moduleResolution, noEmit (+11 more)

### Community 115 - "Whisper Language Spike"
Cohesion: 0.19
Nodes (9): header(), main(), _RecordingModel, section_1_environment(), section_2_code_support(), section_3_decoding_path(), section_4_mock_boundary(), section_5_real_audio() (+1 more)

### Community 116 - "Phase 3.2B12 Banking Intents"
Cohesion: 0.26
Nodes (14): check(), FakeUnderstanding, main(), make_dialogue(), section(), test_amounts(), test_banking_intents(), test_controls_and_acknowledgements() (+6 more)

### Community 117 - "College Backend Type Dependencies"
Cohesion: 0.11
Nodes (17): description, @nestjs/testing@^12.2.0, @types/express@^5.0.6, @types/pg@^8.23.1, @types/qrcode@^1.5.6, @types/supertest@^7.2.1, engines, node (+9 more)

### Community 118 - "College Admin Branch QR"
Cohesion: 0.18
Nodes (11): contextApi, BranchQr(), downloadSvg(), branchQrPayload(), BranchQrProps, QR_OPTIONS, triggerDownload(), parseQrPayload() (+3 more)

### Community 119 - "M10 Policy Tests"
Cohesion: 0.22
Nodes (15): check(), effective(), engine(), expect(), test_d1_wallet_top_up_is_declined(), test_d2_capability_questions_are_answered(), test_d3_loan_repayment_is_declined(), test_d3_repayment_is_never_a_loan_application() (+7 more)

### Community 120 - "College Backend Scripts"
Cohesion: 0.12
Nodes (17): scripts, admin:bootstrap, build, db:migrate:deploy, db:migrate:dev, db:seed, db:status, fees:load (+9 more)

### Community 121 - "Idle Session Reaper"
Cohesion: 0.20
Nodes (6): test_run_once_survives_a_failing_pass(), test_start_stop_lifecycle(), scenario(), test_stop_before_start_is_safe(), scenario(), IdleSessionReaper

### Community 122 - "Bank Backend JWT & Roles"
Cohesion: 0.17
Nodes (5): JwtStrategy, JwtPayload, UserRole, ROLES_KEY, RolesGuard

### Community 123 - "Bank Frontend TS Node Config"
Cohesion: 0.12
Nodes (15): compilerOptions, allowImportingTsExtensions, lib, module, moduleDetection, moduleResolution, noEmit, noUnusedLocals (+7 more)

### Community 124 - "ASR Candidate Availability Spike"
Cohesion: 0.24
Nodes (11): classify_wheels(), covers(), get_json(), header(), main(), probe_model(), probe_package(), section_limits() (+3 more)

### Community 125 - "Evaluation Harness Docs"
Cohesion: 0.18
Nodes (13): m10_expect Decisions (start / clarify / decline / question / refusal), Multilingual Evaluation Harness README (M0), ASR Harness (M9 speech recognition evaluation), IntentDetector Detector-Only View, Evaluation Categories (service_request, knowledge_question, control, amount, negation, conflict_answer, ambiguous_request, refusal), Language Groups (en, kn, hi, kn-en, hi-en, rom-kn, rom-hi), Localization Review Sheet (M6), M10 Routing Safety Evaluator (+5 more)

### Community 127 - "College Frontend 3D Scene"
Cohesion: 0.19
Nodes (14): @react-three/fiber@^9.8.2, three@^0.186.1, ArchedWindow(), columnXs, floatingShapes, GraduationCap(), OrbitRing(), Pediment() (+6 more)

### Community 128 - "College Workflows & Backend Docs"
Cohesion: 0.25
Nodes (15): Phase 5 College Workflows, Admission guidance workflow, Admission status workflow, AssistantAdmissionStatusService, campus_map.py verified campus maps, Campus navigation workflow, domain_runner.py step kinds, POST /sessions/{id}/workflow-result (+7 more)

### Community 129 - "Bank Assistive AI README"
Cohesion: 0.18
Nodes (11): Manual Smoke Tests, MS-01 Banking voice interaction smoke test, Banking Assistant index.html, Language Engine requirements.txt, Bank Assistive AI README, FFmpeg on PATH requirement, GROQ_API_KEY, language_engine (Python AI engine) (+3 more)

### Community 130 - "Control Command Audit"
Cohesion: 0.19
Nodes (13): Refusal Gate (handle_refused_request, M3), Control Commands Integration Audit (Python engine, NestJS, React), Control Command Inventory (exit, pause, resume, cancel, repeat, next, ack, step reference, switch choice, help, yes/no), Prioritized Control Integration Plan (P1 confirm cancel ... P7 browser test), Control Semantics by Workflow State (ACTIVE / SUSPENDED / COMPLETED / CANCELLED / NONE), Deterministic Rule-Based Control Tier (classify_command, classify_turn, handle_control_command), Control Integration Ownership Matrix, S4-S8 Risks (no deterministic yes/help, EXITED unenforced, timeout desync, romanized gaps) (+5 more)

### Community 131 - "College Backend Env Config"
Cohesion: 0.18
Nodes (9): AppConfigModule, booleanString, columnAliases, Env, envSchema, importFields, isLocalHost(), base (+1 more)

### Community 132 - "Test Institute KB Fixtures"
Cohesion: 0.19
Nodes (14): Academic Calendar fixture ALPHA-CAL, Category Certificates fixture ALPHA-CAT, Required Admission Documents fixture ALPHA-DOCS, Admission Process Steps (register, test, counselling, allotment, reporting), Admission Office Contact fixture ALPHA-CONTACT, Tuition Fee fixture ALPHA-FEE (11111 test rupees), Hostel Facilities fixture ALPHA-HOSTEL, Test Institute A Campus (admin block, library, 3 academic blocks) (+6 more)

### Community 133 - "Service TTS Speak Endpoint"
Cohesion: 0.14
Nodes (5): test_direct_call_contract_unchanged(), failing(), _correlation_id(), speak(), TtsHttpError

### Community 134 - "College Backend NestJS Core Deps"
Cohesion: 0.15
Nodes (12): @nestjs/core@^11.0.0, description, @nestjs/schematics@^11.0.0, ts-node@^10.9.2, @nestjs/core, @nestjs/schematics, name, prisma (+4 more)

### Community 135 - "Bank Backend Scripts"
Cohesion: 0.15
Nodes (13): scripts, build, db:seed, dev, prisma:generate, prisma:migrate, prisma:studio, start (+5 more)

### Community 136 - "College Frontend Test Dependencies"
Cohesion: 0.15
Nodes (13): devDependencies, jsdom@^30.0.1, @testing-library/jest-dom@^7.0.1, @testing-library/user-event@^14.6.6, @types/node@^26.4.0, @types/qrcode@^1.5.6, @types/react-dom@^19.0.0, jsdom (+5 more)

### Community 138 - "Deep Integration Audit"
Cohesion: 0.19
Nodes (13): End-to-End Control Trace (React -> NestJS -> Python /turn -> React), Deep Language Engine Integration Audit, ASR, Localization and TTS Contracts, CLI Continuous Listening Loop (VoiceAssistantPipeline.run), Completion Resolution (resolve_step_completion True/False/None, LLM fallback), Frontend Tap-to-Talk Voice Flow (no VAD, no re-listen), Verified Gaps G1-G6, Unverified U1-U5, Defects D1-D6, Integration Plan I1-I6 (observability, browser endpointing, voice loop, speech gate, silence follow-up, robustness) (+5 more)

### Community 139 - "Service Error Responses"
Cohesion: 0.23
Nodes (5): domain_refused(), invalid_request(), _tts_body(), tts_refused(), unhandled()

### Community 140 - "CampusGuide Admin UI Reference"
Cohesion: 0.21
Nodes (12): CampusGuide Admin UI Reference, Admin Dashboard, Import Admissions Upload Screen, Import History Screen, Import Results Validation Screen, Four-Step Import Wizard (Upload, Validate, Review, Import), Admin Login Screen, NUCAT Reference (Student Identifier) (+4 more)

### Community 141 - "CampusGuide Student UI Reference"
Cohesion: 0.23
Nodes (11): Admission Process Page, After-Scan Dashboard (Your Admission Result), Ask CampusGuide (AI Assistance Chat), CampusGuide UI Reference (8-screen mockup), Fee Structure Page, More Admission Resources (Additional Options After Scan), NMAM Institute of Technology (Nitte), NUCAT (Nitte University Common Admission Test) (+3 more)

### Community 142 - "College Frontend QR Dependencies"
Cohesion: 0.17
Nodes (12): dependencies, @fontsource-variable/figtree@^5.3.0, jsqr@^1.4.0, qrcode@^1.5.4, react@^19.0.0, react-dom@^19.0.0, react-router-dom@^7.0.0, qrcode (+4 more)

### Community 143 - "Response Localizer"
Cohesion: 0.18
Nodes (3): ResponseLocalizer, LanguageAwareAnswerer, test_pipeline_passes_the_session_language()

### Community 145 - "College RAG Docs"
Cohesion: 0.27
Nodes (8): Phase 3 College RAG, DomainKnowledgeBase, Content-hash embedding cache, IsolationError institution guard, KnowledgeRetriever (reused), Redacted unanswered log, College Knowledge Collection README, Adding an official knowledge document

### Community 146 - "College Intents Runtime Docs"
Cohesion: 0.25
Nodes (10): Phase 4 College Intents & Runtime, CatalogLocalizer, College intent catalogue, DomainKnowledgeRuntime, GroundedAnswerer, Other-domain (Banking) gate, ProfileIntentDetector, Kannada Review Cases (+2 more)

### Community 147 - "Bank Frontend Dev Dependencies"
Cohesion: 0.18
Nodes (10): @types/react@^19.0.0, typescript@^5.6.0, @vitest/coverage-v8@^4.1.11, @types/react, typescript, name, private, type (+2 more)

### Community 149 - "ESLint Configuration"
Cohesion: 0.27
Nodes (4): eslint-plugin-react-hooks@^7.1.1, eslint-plugin-react-refresh@^0.5.7, eslint-plugin-react-hooks, eslint-plugin-react-refresh

### Community 151 - "Remediation Fallback Understanding"
Cohesion: 0.18
Nodes (3): fallback_understanding(), entities(), understand()

### Community 152 - "Remediation Fake LLM Responses"
Cohesion: 0.24
Nodes (5): __init__(), __init__(), FakeChoice, FakeMessage, FakeResponse

### Community 153 - "Service Config Module"
Cohesion: 0.22
Nodes (3): describe(), make_console_utf8_safe(), _strip_quotes()

### Community 154 - "College Frontend Scripts"
Cohesion: 0.22
Nodes (9): scripts, build, dev, lint, preview, qr:generate, test, test:watch (+1 more)

### Community 155 - "Domain Resolution Docs"
Cohesion: 0.25
Nodes (9): Banking Test Baseline, Banking regression baseline (commit 7081b66), Phase 2 Domain Resolution, AI_ENGINE_COLLEGE_TOKEN, Domain isolation ((domain, session_id) sessions), Token-based domain resolution, Institution binding (409 context_conflict), register_domain_runtime registry (+1 more)

### Community 156 - "Housekeeping Interval Config"
Cohesion: 0.31
Nodes (3): idle_timeout_from_env(), _positive_seconds(), purge_interval_from_env()

### Community 157 - "Bank Backend TS Build Config"
Cohesion: 0.25
Nodes (7): compilerOptions, rootDir, types, exclude, extends, include, ./tsconfig.json

### Community 160 - "Baseline & M1-M3 Reports"
Cohesion: 0.32
Nodes (8): Evaluation Report: baseline_m0, Baseline Failure Modes (questions start workflows, wrong amounts, false conflicts on negation, missed code-mixed controls), Baseline M0 Results (218 fixtures: 128 correct / 47 critical / 36 miss / 7 unscored), Knowledge Retrieval hit@2 and Misses (kn, kn-en weakest), Evaluation Report: m1, M1 Results (143 correct / 32 critical; all 15 wrong_amount fixed), Evaluation Report: m3, M3 Results (161 correct / 7 critical / 38 unscored; questions now LLM-gated, all controls and negations correct)

### Community 161 - "College Backend Nest CLI"
Cohesion: 0.29
Nodes (6): collection, compilerOptions, deleteOutDir, tsConfigPath, $schema, sourceRoot

### Community 162 - "Bank Frontend Scripts"
Cohesion: 0.29
Nodes (7): scripts, build, dev, preview, test, test:watch, typecheck

### Community 163 - "Bank Frontend App Root"
Cohesion: 0.33
Nodes (3): App(), container, router

### Community 166 - "M1/M3 Auxiliary Reports"
Cohesion: 0.33
Nodes (7): Auxiliary Fixtures (amounts_m1, m3_language_cues, m4_heldout, m5_fresh, m7_fresh), Evaluation Report: m1_amounts, M1 Amount Boundary Results (34 fixtures: 33 correct, 1 missed digit-by-digit Kannada), Evaluation Report: m3_targets_after, M3 Targets After (70 correct / 1 critical; all 19 refusals correct), Evaluation Report: m3_targets_before, M3 Targets Before (97 fixtures: 32 correct / 40 critical; refusals start workflows)

### Community 167 - "Bank Backend Nest CLI"
Cohesion: 0.33
Nodes (5): collection, compilerOptions, deleteOutDir, $schema, sourceRoot

### Community 171 - "Offline Synthesis Helpers"
Cohesion: 0.40
Nodes (3): generator(), offline_synthesize(), set_runtime()

### Community 172 - "M10 Label Policy"
Cohesion: 0.53
Nodes (3): M10 Label Policy (development fixtures), Assistant Services (deposit, withdraw, balance, loan, open account), m10_dev.json Development Fixture Set

### Community 174 - "Bank Backend Prisma Seed"
Cohesion: 0.40
Nodes (3): @node-rs/argon2@^2.2.0, prisma, @node-rs/argon2

### Community 177 - "ASR Providers Docs"
Cohesion: 0.70
Nodes (5): ASR Providers, ASR factory routing and fallback, AI4Bharat IndicConformer (ONNX int8), SpeechToText facade, Whisper small (English and fallback)

### Community 179 - "Campus Manifest"
Cohesion: 0.50
Nodes (3): description, domain, maps

### Community 180 - "Knowledge Manifest"
Cohesion: 0.50
Nodes (3): description, documents, domain

### Community 181 - "College Campus Fixture Manifest"
Cohesion: 0.50
Nodes (3): description, domain, maps

### Community 182 - "College KB Fixture Manifest"
Cohesion: 0.50
Nodes (3): description, documents, domain

### Community 186 - "Backend Package Overrides"
Cohesion: 0.67
Nodes (3): uuid, overrides, exceljs

## Knowledge Gaps
- **100 isolated node(s):** `Development`, `Production`, `Test`, `RFC-4180`, `./tsconfig.json` (+95 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 2177 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **57 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `error()` connect `College Assistant Frontend Services` to `Bank Backend AI Engine Client`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Are the 163 inferred relationships involving `WorkflowState` (e.g. with `ConversationManager` and `DialogueManager`) actually correct?**
  _`WorkflowState` has 163 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Development`, `Production`, `Test` to the rest of the system?**
  _100 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `College Assistant Frontend Services` be split into smaller, more focused modules?**
  _Cohesion score 0.02939735423811857 - nodes in this community are weakly interconnected._
- **Why does `WorkflowState` connect `Romanized Batch 1 Tests` to `Language Engine HTTP Service`, `Phase 3.2B3 Dialogue Understanding`, `Phase 3.2B4 Completion Semantics`, `Phase 3.2B2 Turn Classification`, `Dialogue Manager & Engine Core`, `College Workflow Loader`, `Phase 3.2B1 Control Commands`, `Dialogue Response Generation`, `Proactive Assistance Tests`, `Phase 3.2B1 Control Routing Tests`, `Conversation Manager`, `Phase 3.2B14 Workflow Tests`, `M10 Intent Routing`, `Domain Workflow Runner`, `M3 Language Cues`, `M6 Localization`, `Session Registry Tests`, `Phase 3.2B15 Term Normalization`, `College Integration Tests`, `Phase 3.2 Recording Detector Tests`, `Remediation Tests`, `Phase 2.5 Low-Confidence Intents`, `Voice Assistant Pipeline`, `Romanized Workflow Conflicts`, `Service Turn Tests`, `Service Language Tests`, `Phase 3.1 Completion Contract`, `Service Housekeeping Tests`, `Workflow Snapshot Tests`, `Cancel Confirmation Exit Tests`, `LLM Cancel Confirmation`, `Phase 3.2B12 Banking Intents`, `M10 Policy Tests`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Are the 14 inferred relationships involving `ConversationManager` (e.g. with `PausedWorkflow` and `SessionState`) actually correct?**
  _`ConversationManager` has 14 INFERRED edges - model-reasoned connections that need verification._
- **Should `College Assistant Engine Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.03457185039370079 - nodes in this community are weakly interconnected._