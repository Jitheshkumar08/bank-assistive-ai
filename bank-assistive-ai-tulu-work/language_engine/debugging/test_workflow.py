from app.workflow.loader import WorkflowLoader

loader = WorkflowLoader()

workflow = loader.load_workflow("withdraw money")

print(workflow)