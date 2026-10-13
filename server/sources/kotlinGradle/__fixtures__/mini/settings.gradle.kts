rootProject.name = "mini-app"

enableFeaturePreview("TYPESAFE_PROJECT_ACCESSORS")

include(":core")
include(":domain:model", ":domain:usecase")
include(":data:repositoryimpl")
include(":tools:gen")
// include(":ignored")
